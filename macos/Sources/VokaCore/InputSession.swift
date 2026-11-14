import Foundation

public struct KeyInput {
    public let key: String
    public let shift: Bool
    public let alt: Bool
    public init(key: String, shift: Bool = false, alt: Bool = false) {
        self.key = key
        self.shift = shift
        self.alt = alt
    }
}

public protocol SessionDriver: AnyObject {
    var preedit: String { get }
    var failureReason: String? { get }
    /// True while scores for the word being typed are being computed.
    var isScoring: Bool { get }
    /// Called on the main thread when the scoring started by a key has finished: with the new view when
    /// the scores changed the candidates, with nil when there were none.
    var onRescored: ((HostView?) -> Void)? { get set }
    func key(_ input: KeyInput, context: EditContext) -> HostView
    func pick(_ index: Int, context: EditContext) -> HostView
    func restore(context: EditContext) -> HostView
    func flush() -> HostView
}

/// Used when the engine could not be loaded: every key goes to the application untouched.
public final class PassthroughSessionDriver: SessionDriver {
    public init() {}
    public var preedit: String { "" }
    public var failureReason: String? { "engine not loaded" }
    public var onRescored: ((HostView?) -> Void)?
    public var isScoring: Bool { false }
    public func key(_ input: KeyInput, context: EditContext) -> HostView { .unhandled }
    public func pick(_ index: Int, context: EditContext) -> HostView { .unhandled }
    public func restore(context: EditContext) -> HostView { .unhandled }
    public func flush() -> HostView { .unhandled }
}

/// Drives one engine session. Keys never wait for the language model: the typed letter is handled at
/// once, candidates are scored on a background queue, and the shell shows the candidates when the
/// scores arrive (`onRescored`). A key that ends the word waits for scores that are still on their
/// way, but only for `commitWait`.
/// Use from the main thread.
public final class JSSessionDriver: SessionDriver {
    /// One scoring request. `scores` is written once by the scoring queue, before `done` is signalled.
    private final class Scoring {
        let done = DispatchSemaphore(value: 0)
        private let lock = NSLock()
        private var value: [String: Double]?
        private var dropped = false

        var scores: [String: Double]? {
            get { lock.lock(); defer { lock.unlock() }; return value }
            set { lock.lock(); value = newValue; lock.unlock() }
        }
        var isCancelled: Bool { lock.lock(); defer { lock.unlock() }; return dropped }
        func cancel() { lock.lock(); dropped = true; lock.unlock() }
    }

    private static let scoringQueue = DispatchQueue(label: "sh.pili.voka.scoring", qos: .userInteractive)

    private let engine: JSEngine
    private let scorer: CandidateScorer?
    private let commitWait: TimeInterval
    private let sid: Int
    public private(set) var preedit = ""
    public private(set) var failureReason: String?
    public var onRescored: ((HostView?) -> Void)?
    private var failed = false
    private var scoring: Scoring?
    public var isScoring: Bool { scoring != nil }

    /// `commitWait`: how long a key that ends the word waits for scores that are being computed.
    public init?(engine: JSEngine, scorer: CandidateScorer? = LanguageModel.shared, commitWait: TimeInterval = 0.12) {
        let sid = engine.newSession()
        guard sid != 0 else { return nil }
        self.engine = engine
        self.scorer = scorer
        self.commitWait = commitWait
        self.sid = sid
    }

    deinit {
        scoring?.cancel()
        engine.endSession(sid)
    }

    private func track(_ view: HostView?, passCurrentKey: Bool = false) -> HostView {
        guard let view = view else {
            let raw = preedit
            preedit = ""
            failed = true
            failureReason = engine.lastError.isEmpty ? "the engine returned no result" : engine.lastError
            engine.reset(sid)
            return HostView(handled: !raw.isEmpty, passThrough: passCurrentKey,
                            commit: raw.isEmpty ? nil : raw)
        }
        preedit = view.preedit
        return view
    }

    /// Forget the request in flight; its result no longer describes the session.
    private func dropScoring() {
        scoring?.cancel()
        scoring = nil
    }

    /// Hand the scores of `request` to the engine, if they have arrived.
    private func applyScores(of request: Scoring) -> HostView? {
        guard !failed, let scores = request.scores,
              let json = try? JSONSerialization.data(withJSONObject: scores),
              let view = engine.rescore(sid, scoresJSON: String(decoding: json, as: UTF8.self)) else { return nil }
        return track(view)
    }

    private func requestScores(before: String, words: [String]) {
        guard let scorer = scorer else { return }
        let request = Scoring()
        scoring = request
        Self.scoringQueue.async { [weak self] in
            // A request that was overtaken by the next key is not worth computing.
            if !request.isCancelled { request.scores = scorer.scores(before: before, words: words) }
            request.done.signal()
            DispatchQueue.main.async {
                guard let self = self, self.scoring === request else { return }
                self.scoring = nil
                // Without scores the callback still fires, so that a view held back for them is shown.
                self.onRescored?(self.applyScores(of: request))
            }
        }
    }

    public func key(_ input: KeyInput, context: EditContext) -> HostView {
        guard !failed else { return .unhandled }
        if let request = scoring {
            // A letter or a deletion changes the word, and with it the candidates that were scored.
            let editsWord = input.key == "Backspace" || (input.key.count == 1 && input.key.allSatisfy(\.isLetter))
            if !editsWord {
                _ = request.done.wait(timeout: .now() + commitWait)
                _ = applyScores(of: request)
            }
            dropScoring()
        }
        let view = track(engine.key(sid, key: input.key, shift: input.shift, alt: input.alt,
                                    before: context.before, contextJSON: context.hostJSON()), passCurrentKey: true)
        if !failed, let words = view.lm, context.canReplaceBefore {
            requestScores(before: context.before, words: words)
        }
        return view
    }
    public func pick(_ index: Int, context: EditContext) -> HostView {
        guard !failed else { return .unhandled }
        dropScoring()
        return track(engine.pick(sid, index: index, before: context.before))
    }
    public func restore(context: EditContext) -> HostView {
        guard !failed, context.canReplaceBefore else { return .unhandled }
        dropScoring()
        return track(engine.restore(sid, before: context.before))
    }
    public func flush() -> HostView {
        guard !failed else { return .unhandled }
        dropScoring()
        return track(engine.flush(sid))
    }
}
