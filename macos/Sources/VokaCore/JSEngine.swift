import Foundation
import JavaScriptCore

/// What the engine wants the shell to do after a key. Mirrors `HostView` in `src/engine/host.ts`.
public struct HostCandidate: Decodable, Equatable {
    public let word: String
    public let gloss: String
    /// Short badge, e.g. `a→an` when picking the candidate also fixes the article before it.
    public let hint: String

    public init(word: String, gloss: String = "", hint: String = "") {
        self.word = word
        self.gloss = gloss
        self.hint = hint
    }
}

public struct HostCorrection: Decodable, Equatable {
    public let original: String
    public let replacement: String
}

public struct HostView: Decodable, Equatable {
    /// False: the input method did nothing, the application handles the key.
    public var handled: Bool
    /// True: apply deleteBack / commit, then ALSO let the application handle the key.
    public var passThrough: Bool
    /// UTF-16 units of already committed text to delete before the caret, applied before `commit`.
    public var deleteBack: Int
    public var commit: String?
    public var preedit: String
    public var candidates: [HostCandidate]
    /// Highlighted candidate = what Space commits.
    public var selected: Int
    public var explicitSelection: Bool?
    /// Candidate Tab commits, or -1.
    public var tabIndex: Int
    public var show: Bool
    public var correction: HostCorrection?
    /// Words a language model may score before `rescore`; nil = nothing to score.
    public var lm: [String]?

    public init(
        handled: Bool, passThrough: Bool = false, deleteBack: Int = 0, commit: String? = nil,
        preedit: String = "", candidates: [HostCandidate] = [], selected: Int = 0, tabIndex: Int = -1,
        show: Bool = false
    ) {
        self.handled = handled
        self.passThrough = passThrough
        self.deleteBack = deleteBack
        self.commit = commit
        self.preedit = preedit
        self.candidates = candidates
        self.selected = selected
        self.explicitSelection = false
        self.tabIndex = tabIndex
        self.show = show
        self.correction = nil
    }

    public static let unhandled = HostView(handled: false)
}

/// Runs the bundled TypeScript engine (`engine.js`, global `Voka`) in JavaScriptCore.
/// Not thread-safe: use it from one thread (InputMethodKit calls arrive on the main thread).
public final class JSEngine {
    public struct InitInfo: Decodable {
        public let ok: Bool
        public let version: String?
        public let words: Int?
        public let knownTokens: Bool?
        public let ms: Int?
        public let error: String?
    }

    public private(set) var isReady = false
    public private(set) var info: InitInfo?
    /// Why loading failed, or the last JavaScript exception; empty when all is well.
    public private(set) var lastError = ""

    /// The name the engine's script goes by in JavaScript stack traces.
    private static let sourceURL = URL(fileURLWithPath: "/voka/engine.js")

    private var context: JSContext?
    private var host: JSValue?
    private let decoder = JSONDecoder()

    public init() {}

    @discardableResult
    public func load(scriptURL: URL, dictURL: URL) -> Bool {
        isReady = false
        host = nil
        context = nil
        guard let script = try? String(contentsOf: scriptURL, encoding: .utf8) else {
            lastError = "engine.js not found at \(scriptURL.path)"
            return false
        }
        guard let dict = try? String(contentsOf: dictURL, encoding: .utf8) else {
            lastError = "dict.json not found at \(dictURL.path)"
            return false
        }
        guard let ctx = JSContext() else {
            lastError = "JSContext() failed"
            return false
        }
        ctx.name = "Voka"
        ctx.exceptionHandler = { [weak self] _, exception in
            let stack = exception?.objectForKeyedSubscript("stack")?.toString() ?? ""
            self?.lastError = "\(exception?.toString() ?? "unknown JS exception")\n\(stack)"
        }
        lastError = ""
        // A fixed name, not the file's location: a stack trace then says where in the engine an error
        // happened without naming the user's home directory.
        ctx.evaluateScript(script, withSourceURL: Self.sourceURL)
        guard lastError.isEmpty, let api = ctx.objectForKeyedSubscript("Voka"), api.isObject else {
            if lastError.isEmpty { lastError = "engine.js did not define Voka" }
            return false
        }
        let args: [Any] = [dict]
        guard let text = api.invokeMethod("init", withArguments: args)?.toString(),
              let parsed = try? decoder.decode(InitInfo.self, from: Data(text.utf8)) else {
            if lastError.isEmpty { lastError = "Voka.init returned no result" }
            return false
        }
        info = parsed
        guard parsed.ok else {
            lastError = parsed.error ?? "Voka.init failed"
            return false
        }
        context = ctx
        host = api
        isReady = true
        return true
    }

    /// 0 = engine not ready.
    public func newSession() -> Int {
        guard isReady, let v = host?.invokeMethod("newSession", withArguments: []) else { return 0 }
        return Int(v.toInt32())
    }

    public func endSession(_ sid: Int) {
        guard isReady, sid != 0 else { return }
        _ = host?.invokeMethod("endSession", withArguments: [sid])
    }

    public func key(_ sid: Int, key: String, shift: Bool, alt: Bool, ctrl: Bool = false, meta: Bool = false, before: String, contextJSON: String = "{}") -> HostView? {
        view("key", [sid, key, shift, alt, ctrl, meta, before, contextJSON])
    }

    public func pick(_ sid: Int, index: Int, before: String) -> HostView? {
        view("pick", [sid, index, before])
    }

    public func flush(_ sid: Int) -> HostView? {
        view("flush", [sid])
    }

    public func rescore(_ sid: Int, scoresJSON: String) -> HostView? {
        view("rescore", [sid, scoresJSON])
    }

    public func restore(_ sid: Int, before: String) -> HostView? {
        view("restore", [sid, before])
    }

    public func reset(_ sid: Int) {
        guard isReady else { return }
        _ = host?.invokeMethod("reset", withArguments: [sid])
    }

    /// Set engine-wide options from a JSON object, e.g. `{"numberKeysPick": false}`. They apply to
    /// sessions that exist and to new ones; keys that are absent keep their value.
    public func setOptions(json: String) {
        guard isReady else { return }
        _ = host?.invokeMethod("setOptions", withArguments: [json])
    }

    /// The engine's own record of the last error it swallowed (it commits the typed text and steps aside).
    public func engineLastError() -> String {
        guard isReady else { return lastError }
        return host?.invokeMethod("lastError", withArguments: [])?.toString() ?? ""
    }

    private func view(_ method: String, _ args: [Any]) -> HostView? {
        guard isReady, let text = host?.invokeMethod(method, withArguments: args)?.toString() else { return nil }
        do {
            return try decoder.decode(HostView.self, from: Data(text.utf8))
        } catch {
            // The result holds what is being typed (the marked text, the commit, the candidates): the
            // error must not, because it is shown in the input menu and may be logged.
            lastError = "\(method): cannot decode the engine's result (\(text.utf16.count) UTF-16 units)"
            return nil
        }
    }
}
