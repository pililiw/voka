import CoreML
import Foundation
import XCTest
@testable import VokaCore

/// Checks the tokenizer and the Core ML model against `tests/data/lm-fixtures.json`, which
/// `scripts/lm/convert.py` writes from the reference implementation, and checks how the session
/// driver uses a scorer.
final class LanguageModelTests: XCTestCase {
    private static let repoRoot = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()

    private struct Fixtures: Decodable {
        struct Text: Decodable {
            let text: String
            let ids: [Int]
        }
        struct Case: Decodable {
            let before: String
            let words: [String]
            let context_ids: [Int]
            let word_ids: [[Int]]
            let scores: [Double]
        }
        let tokenizer: [Text]
        let cases: [Case]
    }

    private static let fixtures: Fixtures? = {
        guard let data = try? Data(contentsOf: repoRoot.appendingPathComponent("tests/data/lm-fixtures.json")) else { return nil }
        return try? JSONDecoder().decode(Fixtures.self, from: data)
    }()

    private static let tokenizerURL = repoRoot.appendingPathComponent("data/lm-tokenizer.json")

    /// `data/lm.mlpackage` compiled once per version of its weights, under the package's build directory.
    private static let compiledModel: Result<URL, Error> = Result {
        let package = repoRoot.appendingPathComponent("data/lm.mlpackage")
        let weights = package.appendingPathComponent("Data/com.apple.CoreML/weights/weight.bin")
        let attributes = try FileManager.default.attributesOfItem(atPath: weights.path)
        let stamp = Int((attributes[.modificationDate] as? Date)?.timeIntervalSince1970 ?? 0)
        let cache = repoRoot.appendingPathComponent("macos/.build/lm/\(attributes[.size] ?? 0)-\(stamp)")
        let compiled = cache.appendingPathComponent("lm.mlmodelc")
        if !FileManager.default.fileExists(atPath: compiled.path) {
            try? FileManager.default.removeItem(at: cache.deletingLastPathComponent())
            try FileManager.default.createDirectory(at: cache, withIntermediateDirectories: true)
            try FileManager.default.moveItem(at: MLModel.compileModel(at: package), to: compiled)
        }
        return compiled
    }

    /// Without a latency limit: correctness does not depend on the speed of the machine that runs the tests.
    private static let model: LanguageModel = {
        let model = LanguageModel(latencyLimitMs: .infinity)
        if let url = try? compiledModel.get() { model.load(modelURL: url, tokenizerURL: tokenizerURL) }
        return model
    }()

    private func modelOrSkip() throws -> LanguageModel {
        guard FileManager.default.fileExists(atPath: Self.repoRoot.appendingPathComponent("data/lm.mlpackage").path) else {
            throw XCTSkip("data/lm.mlpackage not found - run scripts/lm/convert.py first")
        }
        _ = try Self.compiledModel.get()
        let model = Self.model
        if case .failed(let reason) = model.state { XCTFail(reason) }
        return model
    }

    private func fixtures() throws -> Fixtures {
        try XCTUnwrap(Self.fixtures, "tests/data/lm-fixtures.json is missing or malformed")
    }

    // MARK: Tokenizer

    func testTokenIdsMatchTheReferenceTokenizer() throws {
        let tokenizer = try BPETokenizer(contentsOf: Self.tokenizerURL)
        let fixtures = try fixtures()
        XCTAssertGreaterThan(fixtures.tokenizer.count, 25)
        for item in fixtures.tokenizer {
            XCTAssertEqual(tokenizer.encode(item.text), item.ids, "text: \(item.text.debugDescription)")
        }
        XCTAssertEqual(tokenizer.id(of: "[CLS]"), fixtures.cases.first?.context_ids.first)
    }

    func testForgettingTheRememberedWordsDoesNotChangeTheTokens() throws {
        let tokenizer = try BPETokenizer(contentsOf: Self.tokenizerURL)
        for item in try fixtures().tokenizer.prefix(10) {
            XCTAssertEqual(tokenizer.encode(item.text), item.ids)
            tokenizer.forget()
            XCTAssertEqual(tokenizer.encode(item.text), item.ids, "text: \(item.text.debugDescription)")
        }
    }

    func testTokenizerAcceptsAnyUnicodeText() throws {
        let tokenizer = try BPETokenizer(contentsOf: Self.tokenizerURL)
        var generator = SystemRandomNumberGenerator()
        for _ in 0..<300 {
            var scalars = String.UnicodeScalarView()
            for _ in 0..<Int.random(in: 0...60, using: &generator) {
                let value = Bool.random(using: &generator)
                    ? UInt32.random(in: 0..<0x250, using: &generator)
                    : UInt32.random(in: 0..<0x110000, using: &generator)
                if let scalar = Unicode.Scalar(value) { scalars.append(scalar) }
            }
            let text = String(scalars)
            XCTAssertEqual(tokenizer.encode(text).isEmpty, text.isEmpty)
        }
    }

    // MARK: Model

    func testRequestsMatchTheReferenceTokenIds() throws {
        let model = try modelOrSkip()
        let fixtures = try fixtures()
        XCTAssertGreaterThanOrEqual(fixtures.cases.count, 55)
        for item in fixtures.cases {
            let request = try XCTUnwrap(model.request(before: item.before, words: item.words), "\(item.words)")
            XCTAssertEqual(request.context, item.context_ids, "context of \(item.before.suffix(40).debugDescription)")
            XCTAssertEqual(request.words, item.word_ids, "\(item.words) after \(item.before.suffix(40).debugDescription)")
        }
    }

    func testScoresMatchTheReferenceModel() throws {
        let model = try modelOrSkip()
        XCTAssertEqual(model.state, .ready)
        var worst = 0.0
        for item in try fixtures().cases {
            let scores = try XCTUnwrap(model.scores(before: item.before, words: item.words), "\(item.words)")
            let got = item.words.map { scores[$0] ?? .nan }
            for (i, word) in item.words.enumerated() {
                XCTAssertEqual(got[i], item.scores[i], accuracy: 0.15, "\(word) after \(item.before.suffix(40).debugDescription)")
                worst = max(worst, abs(got[i] - item.scores[i]))
            }
            XCTAssertEqual(got.firstIndex(of: got.max() ?? 0), item.scores.firstIndex(of: item.scores.max() ?? 0), "\(item.words)")
        }
        let latency = try XCTUnwrap(model.latency)
        print(String(format: "Language model: max score difference %.4f · median %.1f ms · p95 %.1f ms", worst, latency.median, latency.p95))
    }

    func testRequestsThatDoNotFitAreNotScored() throws {
        let model = try modelOrSkip()
        XCTAssertNil(model.scores(before: "one ", words: []))
        XCTAssertNil(model.scores(before: "one ", words: ["a", "b", "c", "d", "e", "f", "g"]))
        XCTAssertNil(model.scores(before: "one ", words: [String(repeating: "qzx", count: 30), "two"]))
        XCTAssertNotNil(model.scores(before: "one ", words: ["two", "tow"]))
    }

    func testAModelThatIsNotLoadedHasNoScores() {
        let model = LanguageModel()
        XCTAssertEqual(model.state, .notLoaded)
        XCTAssertNil(model.scores(before: "I think the ", words: ["answer"]))
        XCTAssertNil(model.latency)

        let missing = URL(fileURLWithPath: "/nonexistent/lm.mlmodelc")
        model.load(modelURL: missing, tokenizerURL: missing)
        guard case .failed = model.state else { return XCTFail("\(model.state)") }
        XCTAssertFalse(model.isReady)
        XCTAssertNil(model.scores(before: "I think the ", words: ["answer"]))
    }

    func testAModelThatIsUnloadedHasNoScoresUntilItIsLoadedAgain() throws {
        _ = try modelOrSkip()
        let model = LanguageModel(latencyLimitMs: .infinity)
        let url = try Self.compiledModel.get()
        model.load(modelURL: url, tokenizerURL: Self.tokenizerURL)
        XCTAssertNotNil(model.scores(before: "Because of the bad ", words: ["weather", "whether"]))

        model.unload()
        XCTAssertEqual(model.state, .notLoaded)
        XCTAssertNil(model.scores(before: "Because of the bad ", words: ["weather", "whether"]))

        // A load requested after the unload starts once the model has been released.
        model.loadInBackground(modelURL: url, tokenizerURL: Self.tokenizerURL)
        let deadline = Date().addingTimeInterval(20)
        while model.state != .ready, Date() < deadline { Thread.sleep(forTimeInterval: 0.05) }
        XCTAssertEqual(model.state, .ready)
        XCTAssertNotNil(model.scores(before: "Because of the bad ", words: ["weather", "whether"]))
    }

    func testAModelThatIsTooSlowSwitchesItselfOff() throws {
        _ = try modelOrSkip()
        let model = LanguageModel(latencyLimitMs: 0)
        model.load(modelURL: try Self.compiledModel.get(), tokenizerURL: Self.tokenizerURL)
        // Speed is judged from real requests, not at load.
        XCTAssertEqual(model.state, .ready)
        var answered = 0
        for _ in 0..<40 where model.scores(before: "one ", words: ["two", "tow"]) != nil { answered += 1 }
        XCTAssertGreaterThan(answered, 0)
        XCTAssertLessThan(answered, 40)
        XCTAssertEqual(model.state, .tooSlow)
        XCTAssertNil(model.scores(before: "one ", words: ["two", "tow"]))
        XCTAssertGreaterThan(try XCTUnwrap(model.latency).p95, 0)
    }

    // MARK: Session driver

    private final class FixedScorer: CandidateScorer {
        var requests: [(before: String, words: [String])] = []
        let score: ((String) -> Double)?
        init(_ score: ((String) -> Double)?) { self.score = score }
        func scores(before: String, words: [String]) -> [String: Double]? {
            requests.append((before, words))
            guard let score = score else { return nil }
            return Dictionary(words.map { ($0, score($0)) }) { first, _ in first }
        }
    }

    private static let engine: JSEngine = {
        let engine = JSEngine()
        engine.load(
            scriptURL: repoRoot.appendingPathComponent("macos/Resources/engine.js"),
            dictURL: repoRoot.appendingPathComponent("data/dict.json")
        )
        return engine
    }()

    /// What Space commits after typing `word` at the end of `before`.
    private func commit(_ word: String, after before: String, scorer: CandidateScorer?) throws -> String? {
        let engine = Self.engine
        if !engine.isReady, engine.lastError.contains("not found") {
            throw XCTSkip("\(engine.lastError) - run `node scripts/build-engine-bundle.mjs` first (npm run macos:test does)")
        }
        let driver = try XCTUnwrap(JSSessionDriver(engine: engine, scorer: scorer, commitWait: 2), engine.lastError)
        let length = (before as NSString).length
        let context = EditContext(selection: NSRange(location: length, length: 0),
                                  marked: NSRange(location: NSNotFound, length: 0)) { range in
            NSMaxRange(range) <= length ? (before as NSString).substring(with: range) : nil
        }
        for character in word { _ = driver.key(KeyInput(key: String(character)), context: context) }
        return driver.key(KeyInput(key: " "), context: context).commit
    }

    private struct SentenceCase: Decodable {
        let before: String
        let keys: String
        let accept: [String]
    }

    /// Types `keys` after `before` through a driver that uses the real model; returns what was added.
    private func type(_ keys: String, after before: String, scorer: CandidateScorer) throws -> String {
        let driver = try XCTUnwrap(JSSessionDriver(engine: Self.engine, scorer: scorer, commitWait: 2), Self.engine.lastError)
        var document = before
        for character in keys {
            let length = (document as NSString).length
            let snapshot = document
            let context = EditContext(selection: NSRange(location: length, length: 0),
                                      marked: NSRange(location: NSNotFound, length: 0)) { range in
                NSMaxRange(range) <= length ? (snapshot as NSString).substring(with: range) : nil
            }
            let key = character == "\t" ? "Tab" : String(character)
            let view = driver.key(KeyInput(key: key), context: context)
            if view.handled, let commit = view.commit {
                document = String(document.dropLast(view.deleteBack)) + commit
            }
            if !view.handled || view.passThrough { document += character == "\t" ? "\t" : String(character) }
        }
        return String(document.dropFirst(before.count))
    }

    /// `tests/data/lm-cases.json`: sentences whose outcome depends on the model reading the context.
    func testSentenceCasesWithTheModel() throws {
        let model = try modelOrSkip()
        let data = try Data(contentsOf: Self.repoRoot.appendingPathComponent("tests/data/lm-cases.json"))
        let cases = try JSONDecoder().decode([SentenceCase].self, from: data)
        var failures: [String] = []
        for item in cases {
            let got = try type(item.keys, after: item.before, scorer: model)
            if !item.accept.contains(got) { failures.append("\(item.before)[\(item.keys)] → \(got)   want \(item.accept.joined(separator: " | "))") }
        }
        XCTAssertTrue(failures.isEmpty, "\(failures.count) of \(cases.count):\n" + failures.joined(separator: "\n"))
    }

    func testScoresDecideWhatSpaceCommitsForAnUnknownToken() throws {
        let before = "Because of the bad "
        XCTAssertEqual(try commit("wether", after: before, scorer: nil), "wether ")

        let strong = FixedScorer { $0 == "weather" ? -2 : $0 == "wether" ? -22 : -12 }
        XCTAssertEqual(try commit("wether", after: before, scorer: strong), "weather ")
        XCTAssertTrue(strong.requests.contains { $0.before == before && $0.words.contains("weather") && $0.words.contains("wether") })

        // Weak evidence changes nothing.
        XCTAssertEqual(try commit("wether", after: before, scorer: FixedScorer { _ in -10 }), "wether ")
    }

    private final class SlowScorer: CandidateScorer {
        let delay: TimeInterval
        init(delay: TimeInterval) { self.delay = delay }
        func scores(before: String, words: [String]) -> [String: Double]? {
            Thread.sleep(forTimeInterval: delay)
            return Dictionary(words.map { ($0, $0 == "weather" ? -2.0 : $0 == "wether" ? -22.0 : -12.0) }) { first, _ in first }
        }
    }

    private func context(_ before: String) -> EditContext {
        let length = (before as NSString).length
        return EditContext(selection: NSRange(location: length, length: 0),
                           marked: NSRange(location: NSNotFound, length: 0)) { range in
            NSMaxRange(range) <= length ? (before as NSString).substring(with: range) : nil
        }
    }

    func testKeysDoNotWaitForASlowScorer() throws {
        let before = "Because of the bad "
        let driver = try XCTUnwrap(JSSessionDriver(engine: Self.engine, scorer: SlowScorer(delay: 1.5), commitWait: 0.02))
        let started = Date()
        for character in "wether" { _ = driver.key(KeyInput(key: String(character)), context: context(before)) }
        // Space waits no longer than `commitWait`; without scores the engine's decision stands.
        XCTAssertEqual(driver.key(KeyInput(key: " "), context: context(before)).commit, "wether ")
        // Seven keys take far less than one answer from the scorer, also on a slow machine.
        XCTAssertLessThan(Date().timeIntervalSince(started), 1.0)
    }

    func testScoresThatArriveAfterAKeyRefreshTheCandidates() throws {
        let before = "Because of the bad "
        let driver = try XCTUnwrap(JSSessionDriver(engine: Self.engine, scorer: SlowScorer(delay: 0.05), commitWait: 2))
        let refreshed = expectation(description: "candidates refreshed")
        var first: String?
        driver.onRescored = { view in
            first = view?.candidates.first?.word
            refreshed.fulfill()
        }
        var view = HostView.unhandled
        for character in "wether" { view = driver.key(KeyInput(key: String(character)), context: context(before)) }
        XCTAssertEqual(view.candidates.first?.word, "wether")
        wait(for: [refreshed], timeout: 5)
        XCTAssertEqual(first, "weather")
        XCTAssertEqual(driver.key(KeyInput(key: " "), context: context(before)).commit, "weather ")
    }

    func testAScorerWithoutAnAnswerLeavesTheEngineDecision() throws {
        let before = "Because of the bad "
        let silent = FixedScorer(nil)
        XCTAssertEqual(try commit("wether", after: before, scorer: silent), "wether ")
        XCTAssertFalse(silent.requests.isEmpty)
        XCTAssertEqual(try commit("teh", after: before, scorer: silent), try commit("teh", after: before, scorer: nil))

        // A known word is not open to the scorer, whatever it prefers.
        let contrary = FixedScorer { $0 == "weather" ? -40 : -1 }
        XCTAssertEqual(try commit("weather", after: before, scorer: contrary), "weather ")
    }
}
