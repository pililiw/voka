import CoreML
import Foundation

/// Scores candidate words in context. A nil result means "no opinion": the engine's own decision stands.
public protocol CandidateScorer: AnyObject {
    /// log P(word | text before the caret) for each word.
    func scores(before: String, words: [String]) -> [String: Double]?
}

// MARK: - Tokenizer

/// The byte-level BPE tokenizer described by a Hugging Face `tokenizer.json`:
/// added tokens are cut out first, the rest is NFC-normalized, split into words and merged pair by pair.
/// Special tokens around the text (the post-processor) are left to the caller.
final class BPETokenizer {
    enum LoadError: Error, CustomStringConvertible {
        case malformed(String)
        case unsupported(String)
        var description: String {
            switch self {
            case .malformed(let what): return "tokenizer file: \(what)"
            case .unsupported(let what): return "tokenizer file uses \(what), which is not supported"
            }
        }
    }

    private struct AddedToken {
        let id: Int
        let scalars: [Unicode.Scalar]
        let stripLeft: Bool
        let stripRight: Bool
    }

    /// Added tokens by first scalar, longest first.
    private typealias AddedIndex = [Unicode.Scalar: [AddedToken]]

    private let byteIds: [Int]
    /// (left id, right id) -> (rank, merged id).
    private let merges: [UInt64: (rank: Int, id: Int)]
    private let rawAdded: AddedIndex
    private let normalizedAdded: AddedIndex
    private let ids: [String: Int]
    private let normalize: Bool
    private var cache: [String: [Int]] = [:]

    /// The pre-tokenizer's pattern, with `\s` written out as the class the reference implementation uses.
    private static let words: NSRegularExpression = {
        let space = #"\t\n\x0B\f\r\x85\p{Z}"#
        let pattern = #"'s|'t|'re|'ve|'m|'ll|'d| ?\p{L}+| ?\p{N}+| ?[^S\p{L}\p{N}]+|[S]+(?![^S])|[S]+"#
            .replacingOccurrences(of: "S", with: space)
        // The pattern is a constant; it always compiles.
        return try! NSRegularExpression(pattern: pattern)
    }()

    init(contentsOf url: URL) throws {
        guard let root = try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any],
              let model = root["model"] as? [String: Any],
              let vocab = model["vocab"] as? [String: Int],
              let mergeList = model["merges"] as? [Any] else {
            throw LoadError.malformed("no BPE vocabulary")
        }
        if let type = model["type"] as? String, type != "BPE" { throw LoadError.unsupported("a \(type) model") }
        for key in ["continuing_subword_prefix", "end_of_word_suffix"] {
            if let value = model[key] as? String, !value.isEmpty { throw LoadError.unsupported(key) }
        }
        if model["ignore_merges"] as? Bool == true { throw LoadError.unsupported("ignore_merges") }
        guard let pre = root["pre_tokenizer"] as? [String: Any], pre["type"] as? String == "ByteLevel",
              pre["add_prefix_space"] as? Bool != true, pre["use_regex"] as? Bool != false else {
            throw LoadError.unsupported("a pre-tokenizer other than ByteLevel without a prefix space")
        }
        if let normalizer = root["normalizer"] as? [String: Any] {
            guard normalizer["type"] as? String == "NFC" else { throw LoadError.unsupported("a normalizer other than NFC") }
            normalize = true
        } else {
            normalize = false
        }

        // Byte-level symbols: each byte is written as one printable character.
        var symbols: [Unicode.Scalar] = []
        var next: UInt32 = 256
        for byte in UInt32(0)..<256 {
            let printable = (0x21...0x7E).contains(byte) || (0xA1...0xAC).contains(byte) || (0xAE...0xFF).contains(byte)
            symbols.append(Unicode.Scalar(printable ? byte : next)!)
            if !printable { next += 1 }
        }
        // 0xC0, 0xC1 and 0xF5...0xFF never occur in UTF-8, so a vocabulary may leave them out.
        byteIds = try symbols.enumerated().map { byte, symbol in
            if let id = vocab[String(symbol)] { return id }
            guard byte == 0xC0 || byte == 0xC1 || byte >= 0xF5 else { throw LoadError.malformed("no token for byte \(byte)") }
            return -1
        }

        var merges: [UInt64: (rank: Int, id: Int)] = [:]
        merges.reserveCapacity(mergeList.count)
        for (rank, entry) in mergeList.enumerated() {
            let pair: [String]
            if let list = entry as? [String] {
                pair = list
            } else if let text = entry as? String {
                pair = text.split(separator: " ", omittingEmptySubsequences: false).map(String.init)
            } else {
                pair = []
            }
            guard pair.count == 2, let left = vocab[pair[0]], let right = vocab[pair[1]],
                  let merged = vocab[pair[0] + pair[1]] else {
                throw LoadError.malformed("merge \(rank) does not match the vocabulary")
            }
            let key = Self.pairKey(left, right)
            if merges[key] == nil { merges[key] = (rank, merged) }
        }
        self.merges = merges

        var rawAdded: AddedIndex = [:]
        var normalizedAdded: AddedIndex = [:]
        var ids = vocab
        for entry in root["added_tokens"] as? [[String: Any]] ?? [] {
            guard let id = entry["id"] as? Int, let content = entry["content"] as? String, !content.isEmpty else {
                throw LoadError.malformed("an added token without id or content")
            }
            if entry["single_word"] as? Bool == true { throw LoadError.unsupported("single_word added tokens") }
            ids[content] = id
            let normalized = entry["normalized"] as? Bool ?? true
            let text = normalized && normalize ? content.precomposedStringWithCanonicalMapping : content
            let token = AddedToken(id: id, scalars: Array(text.unicodeScalars),
                                   stripLeft: entry["lstrip"] as? Bool ?? false,
                                   stripRight: entry["rstrip"] as? Bool ?? false)
            if normalized {
                normalizedAdded[token.scalars[0], default: []].append(token)
            } else {
                rawAdded[token.scalars[0], default: []].append(token)
            }
        }
        let longestFirst: (AddedIndex) -> AddedIndex = { $0.mapValues { $0.sorted { $0.scalars.count > $1.scalars.count } } }
        self.rawAdded = longestFirst(rawAdded)
        self.normalizedAdded = longestFirst(normalizedAdded)
        self.ids = ids
    }

    /// The id of a token given as text, e.g. a special token.
    func id(of token: String) -> Int? { ids[token] }

    func encode(_ text: String) -> [Int] {
        var out: [Int] = []
        for (id, raw) in split(Array(text.unicodeScalars), by: rawAdded) {
            if let id = id {
                out.append(id)
                continue
            }
            var piece = String(String.UnicodeScalarView(raw))
            if normalize, !raw.allSatisfy(\.isASCII) { piece = piece.precomposedStringWithCanonicalMapping }
            for (id, plain) in split(Array(piece.unicodeScalars), by: normalizedAdded) {
                if let id = id {
                    out.append(id)
                } else {
                    encodePlain(String(String.UnicodeScalarView(plain)), into: &out)
                }
            }
        }
        return out
    }

    /// Cut `text` at added tokens, leftmost first and longest first at one position.
    private func split(_ text: [Unicode.Scalar], by index: AddedIndex) -> [(id: Int?, text: ArraySlice<Unicode.Scalar>)] {
        var parts: [(id: Int?, text: ArraySlice<Unicode.Scalar>)] = []
        var done = 0
        var i = 0
        while i < text.count {
            guard let token = index[text[i]]?.first(where: { text[i...].starts(with: $0.scalars) }) else {
                i += 1
                continue
            }
            var start = i
            var end = i + token.scalars.count
            if token.stripLeft {
                while start > done, text[start - 1].properties.isWhitespace { start -= 1 }
            }
            if token.stripRight {
                while end < text.count, text[end].properties.isWhitespace { end += 1 }
            }
            if start > done { parts.append((nil, text[done..<start])) }
            parts.append((token.id, text[start..<end]))
            done = end
            i = end
        }
        if done < text.count { parts.append((nil, text[done...])) }
        return parts
    }

    private func encodePlain(_ text: String, into out: inout [Int]) {
        let whole = text as NSString
        Self.words.enumerateMatches(in: text, range: NSRange(location: 0, length: whole.length)) { match, _, _ in
            guard let match = match else { return }
            let word = whole.substring(with: match.range)
            if let known = cache[word] {
                out.append(contentsOf: known)
                return
            }
            let tokens = merge(word.utf8.map { byteIds[Int($0)] })
            if cache.count >= 20_000 { cache.removeAll(keepingCapacity: true) }
            cache[word] = tokens
            out.append(contentsOf: tokens)
        }
    }

    private static func pairKey(_ left: Int, _ right: Int) -> UInt64 {
        UInt64(UInt32(truncatingIfNeeded: left)) << 32 | UInt64(UInt32(truncatingIfNeeded: right))
    }

    /// Apply the learned merges to one word, always the earliest-learned pair first.
    private func merge(_ symbols: [Int]) -> [Int] {
        var word = symbols
        while word.count > 1 {
            var best: (rank: Int, id: Int)?
            var bestKey: UInt64 = 0
            for i in 0..<(word.count - 1) {
                let key = Self.pairKey(word[i], word[i + 1])
                if let found = merges[key], found.rank < best?.rank ?? Int.max {
                    best = found
                    bestKey = key
                }
            }
            guard let merged = best else { break }
            var next: [Int] = []
            next.reserveCapacity(word.count)
            var i = 0
            while i < word.count {
                if i + 1 < word.count, Self.pairKey(word[i], word[i + 1]) == bestKey {
                    next.append(merged.id)
                    i += 2
                } else {
                    next.append(word[i])
                    i += 1
                }
            }
            word = next
        }
        return word
    }
}

// MARK: - Model

/// A causal language model that runs on this machine through Core ML and scores the candidates for
/// the word being typed. It makes no network connections and writes no files.
///
/// The model is loaded and timed off the main thread. Until that is done, and whenever predictions are
/// too slow to run on every keystroke, `scores` returns nil.
public final class LanguageModel: CandidateScorer {
    public static let shared = LanguageModel()

    public enum State: Equatable {
        case notLoaded
        case loading
        case ready
        /// Predictions take too long on this machine; they are measured again later.
        case tooSlow
        case failed(String)
    }

    /// The context that is scored: the last `contextCharacters` code points before the caret, then the
    /// last `contextTokens` tokens of those. The engine's rule is fitted to scores made this way.
    static let contextCharacters = 240
    static let contextTokens = 32

    /// Predictions run off the main thread and keys do not wait for them, so this is not about typing
    /// feel: beyond it the scores arrive too late to be of use, and the model is not worth its energy.
    public static let defaultLatencyLimitMs = 120.0
    private static let retryInterval: TimeInterval = 300
    private static let warmUpRuns = 5
    /// Predictions to see before judging the speed.
    private static let minimumSamples = 12
    private static let windowSize = 40

    private struct Shape {
        let context: Int
        let rows: Int
        let wordTokens: Int
        let targets: Int
        let bos: Int
        let pad: Int
    }

    struct Request {
        let context: [Int]
        let words: [[Int]]
    }

    private let lock = NSLock()
    private let predicting = NSLock()
    private let queue = DispatchQueue(label: "sh.pili.voka.language-model", qos: .utility)

    // Guarded by `lock`.
    private var current = State.notLoaded
    private var latencies: [Double] = []
    private var retryAt = Date.distantFuture

    // Set once before the state becomes `ready`; used only while holding `predicting`.
    private var tokenizer: BPETokenizer?
    private var model: MLModel?
    private var shape: Shape?
    private var cachedContext: (text: String, ids: [Int])?

    private let latencyLimitMs: Double

    public init(latencyLimitMs: Double = LanguageModel.defaultLatencyLimitMs) {
        self.latencyLimitMs = latencyLimitMs
    }

    public var state: State {
        lock.lock()
        defer { lock.unlock() }
        return current
    }

    public var isReady: Bool { state == .ready }

    /// Median and 95th percentile of the recent predictions, in milliseconds.
    public var latency: (median: Double, p95: Double)? {
        lock.lock()
        defer { lock.unlock() }
        return Self.summary(latencies)
    }

    /// Load in the background; `scores` returns nil until the model is ready.
    public func loadInBackground(modelURL: URL, tokenizerURL: URL) {
        queue.async { self.load(modelURL: modelURL, tokenizerURL: tokenizerURL) }
    }

    /// Load a compiled model (`.mlmodelc`) and its tokenizer and warm it up. Blocks for a few hundred milliseconds.
    public func load(modelURL: URL, tokenizerURL: URL) {
        lock.lock()
        let busy = current == .loading
        if !busy { current = .loading }
        lock.unlock()
        guard !busy else { return }

        predicting.lock()
        var failure: String?
        do {
            let tokenizer = try BPETokenizer(contentsOf: tokenizerURL)
            let configuration = MLModelConfiguration()
            // Measured fastest for this model, and float32 on the CPU gives the same scores on every Mac.
            configuration.computeUnits = .cpuOnly
            let model = try MLModel(contentsOf: modelURL, configuration: configuration)
            guard let shape = Self.shape(of: model) else { throw BPETokenizer.LoadError.malformed("unexpected model inputs") }
            self.tokenizer = tokenizer
            self.model = model
            self.shape = shape
            cachedContext = nil
        } catch {
            failure = String(describing: error)
        }
        predicting.unlock()

        if let failure = failure {
            lock.lock()
            current = .failed(failure)
            lock.unlock()
            return
        }
        warmUp()
    }

    /// Stop scoring at once and release the model in the background, after a load that is under way.
    public func unload() {
        lock.lock()
        current = .notLoaded
        lock.unlock()
        queue.async {
            self.predicting.lock()
            self.tokenizer = nil
            self.model = nil
            self.shape = nil
            self.cachedContext = nil
            self.predicting.unlock()
            self.lock.lock()
            self.current = .notLoaded
            self.latencies = []
            self.lock.unlock()
        }
    }

    public func scores(before: String, words: [String]) -> [String: Double]? {
        lock.lock()
        // After a while a model that was too slow gets another chance: the machine may have been busy.
        if current == .tooSlow, Date() >= retryAt {
            latencies = []
            current = .ready
        }
        let state = current
        lock.unlock()
        // The lock is only contended while the model is warming up; a key never waits for that.
        guard state == .ready, !words.isEmpty, predicting.try() else { return nil }
        defer { predicting.unlock() }

        let started = DispatchTime.now().uptimeNanoseconds
        guard let request = request(before: before, words: words), let values = predict(request) else { return nil }
        record(Double(DispatchTime.now().uptimeNanoseconds - started) / 1e6)

        var result: [String: Double] = [:]
        for (word, value) in zip(words, values) {
            guard value.isFinite else { return nil }
            result[word] = (value * 1000).rounded() / 1000
        }
        return result
    }

    // MARK: Requests

    /// Token ids for a request, or nil when it does not fit the model's fixed shape.
    func request(before: String, words: [String]) -> Request? {
        guard let tokenizer = tokenizer, let shape = shape else { return nil }
        let context: [Int]
        if let cached = cachedContext, cached.text == before {
            context = cached.ids
        } else {
            let text = Self.trimmedEnd(before).suffix(Self.contextCharacters)
            let ids = tokenizer.encode(String(String.UnicodeScalarView(text)))
            context = [shape.bos] + ids.suffix(min(Self.contextTokens, shape.context - 1))
            cachedContext = (before, context)
        }
        // A word that continues a line is written after a space.
        let lead = before.unicodeScalars.contains { !Self.isSpace($0) } ? " " : ""
        let wordIds = words.map { tokenizer.encode(lead + $0) }
        let total = wordIds.reduce(0) { $0 + $1.count }
        guard wordIds.count <= shape.rows, total <= shape.targets,
              wordIds.allSatisfy({ !$0.isEmpty && $0.count <= shape.wordTokens }) else { return nil }
        return Request(context: context, words: wordIds)
    }

    /// Token ids of `text` alone, as the tokenizer produces them.
    func encode(_ text: String) -> [Int]? {
        predicting.lock()
        defer { predicting.unlock() }
        return tokenizer?.encode(text)
    }

    /// White space as the scoring contract defines it: Unicode White_Space and the four ASCII separators.
    private static func isSpace(_ scalar: Unicode.Scalar) -> Bool {
        scalar.properties.isWhitespace || (0x1C...0x1F).contains(scalar.value)
    }

    private static func trimmedEnd(_ text: String) -> ArraySlice<Unicode.Scalar> {
        let scalars = Array(text.unicodeScalars)
        var end = scalars.count
        while end > 0, isSpace(scalars[end - 1]) { end -= 1 }
        return scalars[..<end]
    }

    // MARK: Prediction

    private static func shape(of model: MLModel) -> Shape? {
        let inputs = model.modelDescription.inputDescriptionsByName
        let metadata = model.modelDescription.metadata[.creatorDefinedKey] as? [String: String] ?? [:]
        guard let context = inputs["context_ids"]?.multiArrayConstraint?.shape, context.count == 2,
              let words = inputs["word_ids"]?.multiArrayConstraint?.shape, words.count == 2,
              let positions = inputs["positions"]?.multiArrayConstraint?.shape, positions.count == 1,
              inputs["context_length"] != nil, model.modelDescription.outputDescriptionsByName["log_probs"] != nil,
              let bos = metadata["bos_token_id"].flatMap({ Int($0) }),
              let pad = metadata["pad_token_id"].flatMap({ Int($0) }) else { return nil }
        return Shape(context: context[1].intValue, rows: words[0].intValue, wordTokens: words[1].intValue,
                     targets: positions[0].intValue, bos: bos, pad: pad)
    }

    /// The summed log-probability of each word's tokens. The caller holds `predicting`.
    private func predict(_ request: Request) -> [Double]? {
        guard let model = model, let shape = shape,
              let contextIds = try? MLMultiArray(shape: [1, NSNumber(value: shape.context)], dataType: .int32),
              let contextLength = try? MLMultiArray(shape: [1], dataType: .int32),
              let wordIds = try? MLMultiArray(shape: [NSNumber(value: shape.rows), NSNumber(value: shape.wordTokens)], dataType: .int32),
              let positions = try? MLMultiArray(shape: [NSNumber(value: shape.targets)], dataType: .int32) else { return nil }

        @discardableResult
        func fill(_ array: MLMultiArray, _ value: Int) -> UnsafeMutablePointer<Int32> {
            let pointer = array.dataPointer.bindMemory(to: Int32.self, capacity: array.count)
            pointer.update(repeating: Int32(value), count: array.count)
            return pointer
        }
        // Context at the end of its row, padding before it; words at the start of theirs, padding after.
        let context = fill(contextIds, shape.pad)
        let offset = shape.context - request.context.count
        for (i, id) in request.context.enumerated() { context[offset + i] = Int32(id) }
        fill(contextLength, request.context.count)
        let rows = fill(wordIds, shape.pad)
        let targets = fill(positions, 0)
        var used = 0
        for (row, word) in request.words.enumerated() {
            for (i, id) in word.enumerated() {
                rows[row * shape.wordTokens + i] = Int32(id)
                targets[used] = Int32(row * shape.wordTokens + i)
                used += 1
            }
        }

        guard let input = try? MLDictionaryFeatureProvider(dictionary: [
            "context_ids": contextIds, "context_length": contextLength, "word_ids": wordIds, "positions": positions,
        ]), let output = try? model.prediction(from: input).featureValue(for: "log_probs")?.multiArrayValue,
              output.count >= used else { return nil }

        var sums: [Double] = []
        var next = 0
        for word in request.words {
            var sum = 0.0
            for _ in word {
                sum += output[next].doubleValue
                next += 1
            }
            sums.append(sum)
        }
        return sums
    }

    // MARK: Latency

    private static func summary(_ samples: [Double]) -> (median: Double, p95: Double)? {
        guard !samples.isEmpty else { return nil }
        let sorted = samples.sorted()
        return (sorted[sorted.count / 2], sorted[Int((Double(sorted.count) * 0.95).rounded(.up)) - 1])
    }

    /// Run the model a few times so that the first key does not pay for its start-up, then open it
    /// for use. Speed is judged only from predictions made while handling keys (`record`): a
    /// background process is scheduled differently from the handling of a key, so a timing taken here
    /// would not say how the model performs when it matters.
    private func warmUp() {
        predicting.lock()
        var works = false
        if let shape = shape {
            let request = Request(context: [shape.bos], words: [[shape.pad]])
            works = (0..<Self.warmUpRuns).allSatisfy { _ in predict(request) != nil }
        }
        predicting.unlock()

        lock.lock()
        latencies = []
        current = works ? .ready : .failed("the model cannot be evaluated")
        lock.unlock()
    }

    private func record(_ milliseconds: Double) {
        lock.lock()
        latencies.append(milliseconds)
        if latencies.count > Self.windowSize { latencies.removeFirst(latencies.count - Self.windowSize) }
        settle()
        lock.unlock()
    }

    /// Apply the latency rule to the recent samples. The caller holds `lock`.
    private func settle() {
        guard latencies.count >= Self.minimumSamples, let recent = Self.summary(latencies) else { return }
        if recent.p95 > latencyLimitMs {
            current = .tooSlow
            retryAt = Date().addingTimeInterval(Self.retryInterval)
        } else {
            current = .ready
        }
    }
}
