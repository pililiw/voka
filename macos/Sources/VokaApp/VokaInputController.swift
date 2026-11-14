import Cocoa
import Carbon
import Combine
import InputMethodKit
import VokaCore

enum SharedRuntime {
    /// Terminals handle Tab and Enter themselves, so keys go straight through there.
    static let passthroughApps: Set<String> = [
        "com.apple.Terminal",
        "com.googlecode.iterm2",
        "dev.warp.Warp-Stable",
        "net.kovidgoyal.kitty",
        "com.github.wez.wezterm",
        "org.alacritty",
        "com.mitchellh.ghostty"
    ]

    private static func resourceURL(_ name: String, _ ext: String, devPath: String) -> URL {
        Bundle.main.url(forResource: name, withExtension: ext)
            ?? URL(fileURLWithPath: FileManager.default.currentDirectoryPath).appendingPathComponent(devPath)
    }

    static let js: JSEngine = {
        let engine = JSEngine()
        engine.load(
            scriptURL: resourceURL("engine", "js", devPath: "macos/Resources/engine.js"),
            dictURL: resourceURL("dict", "json", devPath: "data/dict.json")
        )
        engine.setOptions(json: Settings.shared.engineOptionsJSON)
        return engine
    }()

    /// The language model behind a switch, so that sessions follow the Local AI setting as it changes.
    static let scorer = SwitchableScorer(LanguageModel.shared, isEnabled: Settings.shared.localAI)

    static func makeDriver() -> SessionDriver {
        if js.isReady, let driver = JSSessionDriver(engine: js, scorer: scorer) {
            return driver
        }
        return PassthroughSessionDriver()
    }

    /// The compiled model and its tokenizer, when the bundle has them.
    static var languageModelFiles: (model: URL, tokenizer: URL)? {
        guard let model = Bundle.main.url(forResource: "lm", withExtension: "mlmodelc"),
              let tokenizer = Bundle.main.url(forResource: "lm-tokenizer", withExtension: "json") else { return nil }
        return (model, tokenizer)
    }

    /// Bring the language model in line with the Local AI setting: loaded in the background when on
    /// (typing does not wait for it), released when off.
    static func applyLocalAI(_ isOn: Bool) {
        scorer.isEnabled = isOn
        let model = LanguageModel.shared
        guard isOn else {
            if model.state != .notLoaded { model.unload() }
            return
        }
        switch model.state {
        case .notLoaded, .failed:
            if let files = languageModelFiles {
                model.loadInBackground(modelURL: files.model, tokenizerURL: files.tokenizer)
            }
        case .loading, .ready, .tooSlow:
            break
        }
    }

    private static var settingsObservers: [AnyCancellable] = []

    /// Apply the settings now and whenever one changes.
    static func follow(_ settings: Settings) {
        settingsObservers = [
            settings.$numberKeysPick.sink { js.setOptions(json: Settings.engineOptionsJSON(numberKeysPick: $0)) },
            settings.$localAI.sink { isOn in if js.isReady { applyLocalAI(isOn) } }
        ]
    }

    private static var languageModelStatus: String {
        let model = LanguageModel.shared
        let strings = Strings.current
        switch model.state {
        case .notLoaded: return ""
        case .loading: return " · " + strings.modelStatusLoading
        case .ready: return " · " + (model.latency.map { strings.modelStatusLatency($0.median) } ?? strings.modelStatusReady)
        case .tooSlow: return " · " + strings.modelStatusSlow(model.latency?.p95 ?? 0)
        case .failed(let reason): return " · " + strings.modelStatusUnavailable(firstLine(reason))
        }
    }

    static var engineStatus: String {
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? ""
        if js.isReady {
            return "Voka \(version)\(languageModelStatus)"
        }
        return "Voka \(version) · \(Strings.current.passingThrough(firstLine(js.lastError)))"
    }

    static func firstLine(_ text: String) -> String {
        String((text.split(separator: "\n").first ?? "unknown error").prefix(80))
    }
}

@objc(VokaInputController)
public final class VokaInputController: IMKInputController {
    private var session: SessionDriver = SharedRuntime.makeDriver()
    private weak var lastClient: IMKTextInput?
    private var clientBundleId: String = ""
    /// Whether the client currently shows our marked (underlined) text.
    private var hasMarkedText = false
    private var correctionAnchor: Int?

    private static let noRange = NSRange(location: NSNotFound, length: NSNotFound)

    private var isPassthroughApp: Bool {
        !clientBundleId.isEmpty && SharedRuntime.passthroughApps.contains(clientBundleId)
    }

    override public func activateServer(_ sender: Any!) {
        super.activateServer(sender)
        if session.failureReason != nil { session = SharedRuntime.makeDriver() }
        session.onRescored = { [weak self] view in self?.showHeld(rescored: view) }
        lastClient = sender as? IMKTextInput
        clientBundleId = lastClient?.bundleIdentifier() ?? ""

        CandidateWindowController.shared.onSelectCandidate = { [weak self] idx in
            guard let self = self, let client = self.lastClient else { return }
            let context = self.readContext(client: client)
            let raw = self.session.preedit
            let view = self.session.pick(idx, context: context)
            _ = self.apply(view, to: client, context: context, rawBefore: raw)
        }

        CandidateWindowController.shared.onRestoreCorrection = { [weak self] in
            guard let self = self, let client = self.lastClient else { return }
            let context = self.readContext(client: client)
            guard context.selection.location == self.correctionAnchor, !context.hasSelection else {
                hideCandidates()
                return
            }
            let view = self.session.restore(context: context)
            self.correctionAnchor = nil
            _ = self.apply(view, to: client, context: context, rawBefore: "")
        }
    }

    override public func deactivateServer(_ sender: Any!) {
        flushComposition(to: sender as? IMKTextInput)
        super.deactivateServer(sender)
    }

    override public func commitComposition(_ sender: Any!) {
        flushComposition(to: sender as? IMKTextInput)
    }

    override public func hidePalettes() {
        correctionAnchor = nil
        hideCandidates()
        super.hidePalettes()
    }

    /// End the composition keeping exactly what was typed (focus change, click elsewhere, shortcut, secure input).
    private func flushComposition(to client: IMKTextInput?) {
        let view = session.flush()
        if let client = client ?? lastClient {
            if let raw = view.commit, !raw.isEmpty {
                client.insertText(raw, replacementRange: Self.noRange)
            } else if hasMarkedText {
                client.setMarkedText("", selectionRange: NSRange(location: 0, length: 0), replacementRange: Self.noRange)
            }
        }
        hasMarkedText = false
        correctionAnchor = nil
        hideCandidates()
    }

    private func readContext(client: IMKTextInput) -> EditContext {
        EditContext(selection: client.selectedRange(), marked: client.markedRange()) {
            client.attributedSubstring(from: $0)?.string
        }
    }

    private func queryCaretScreenRect(client: IMKTextInput) -> NSRect? {
        var lineRect = NSRect.zero
        // IMKTextInput's index is relative to the inline composition, NOT the document.
        // Zero anchors the panel to the start of the marked word (or the selection without marked
        // text). Passing markedRange.location asks the client for an unrelated, often offscreen index.
        _ = client.attributes(forCharacterIndex: 0, lineHeightRectangle: &lineRect)
        guard lineRect != .zero, !lineRect.isNull, !lineRect.isInfinite,
              lineRect.origin.x.isFinite, lineRect.origin.y.isFinite,
              lineRect.width.isFinite, lineRect.height.isFinite,
              lineRect.height > 0 else { return nil }
        return lineRect
    }

    /// KeyboardEvent.key style names for the keys the engine treats specially.
    private static let namedKeys: [UInt16: String] = [
        51: "Backspace", 36: "Enter", 76: "Enter", 48: "Tab", 53: "Escape",
        123: "ArrowLeft", 124: "ArrowRight", 125: "ArrowDown", 126: "ArrowUp",
        117: "Delete", 115: "Home", 119: "End", 116: "PageUp", 121: "PageDown"
    ]

    private static func keyName(for event: NSEvent, option: Bool) -> String? {
        if let name = namedKeys[event.keyCode] { return name }
        // With Option held, `characters` is the composed symbol (⌥1 = ¡): the engine needs the plain key.
        let chars = (option ? event.charactersIgnoringModifiers : event.characters) ?? ""
        guard chars.count == 1, let scalar = chars.unicodeScalars.first else { return nil }
        // Function keys and other AppKit private-use codes are not text.
        if (0xF700...0xF8FF).contains(scalar.value) { return "Unidentified" }
        if scalar.value < 0x20 || scalar.value == 0x7F { return "Unidentified" }
        return chars
    }

    override public func handle(_ event: NSEvent!, client sender: Any!) -> Bool {
        guard let event = event, event.type == .keyDown,
              let client = sender as? IMKTextInput else {
            return false
        }
        lastClient = client

        // Never intercept Secure Event Input (password fields), terminal apps,
        // or Cmd / Ctrl shortcuts: keep what was typed and step aside.
        let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
        let isShortcut = flags.contains(.command) || flags.contains(.control)
        if IsSecureEventInputEnabled() || isPassthroughApp || isShortcut {
            flushComposition(to: client)
            return false
        }

        let option = flags.contains(.option)
        guard let key = Self.keyName(for: event, option: option) else {
            flushComposition(to: client)
            return false
        }
        let input = KeyInput(
            key: key,
            shift: flags.contains(.shift),
            alt: option
        )

        let context = readContext(client: client)
        correctionAnchor = nil
        let raw = session.preedit
        let view = session.key(input, context: context)
        if view.handled {
            guard apply(view, to: client, context: context, rawBefore: raw) else { return false }
            if !view.passThrough { return true }
        } else {
            hideCandidates()
        }

        return false
    }

    /// Candidates held back while their scores are computed, so that the window changes once per key
    /// instead of showing the engine's order and then the final one.
    private var heldCandidates: (view: HostView, caretRect: NSRect)?
    private var heldDeadline: DispatchWorkItem?
    /// Longer than the model usually takes; after this the engine's order is shown as it is.
    private static let holdCandidates: TimeInterval = 0.05

    private func hold(_ view: HostView, caretRect: NSRect) {
        heldDeadline?.cancel()
        heldCandidates = (view, caretRect)
        let deadline = DispatchWorkItem { [weak self] in self?.showHeld(rescored: nil) }
        heldDeadline = deadline
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.holdCandidates, execute: deadline)
    }

    private func hideCandidates() {
        dropHeld()
        CandidateWindowController.shared.hide()
    }

    private func dropHeld() {
        heldDeadline?.cancel()
        heldDeadline = nil
        heldCandidates = nil
    }

    /// Show the held candidates, in the order the scores gave them if there is one.
    private func showHeld(rescored: HostView?) {
        let held = heldCandidates
        dropHeld()
        guard hasMarkedText else { return }
        if let held = held {
            CandidateWindowController.shared.showCandidates(view: rescored ?? held.view, caretRect: held.caretRect)
        } else if let view = rescored, view.show, !view.candidates.isEmpty, let client = lastClient,
                  let caretRect = queryCaretScreenRect(client: client) {
            // The deadline passed and the engine's order is on screen: correct it.
            CandidateWindowController.shared.showCandidates(view: view, caretRect: caretRect)
        }
    }

    @discardableResult
    private func apply(_ view: HostView, to client: IMKTextInput, context: EditContext, rawBefore: String) -> Bool {
        let empty = NSRange(location: 0, length: 0)
        var inserted = false
        if let commit = view.commit {
            var replaceRange = Self.noRange
            if view.deleteBack > 0 {
                guard client.selectedRange() == context.selection,
                      client.markedRange() == context.marked,
                      let verified = context.replacementRange(deleting: view.deleteBack, read: {
                          client.attributedSubstring(from: $0)?.string
                      }) else {
                    // Keep the original composition; the app will process the current key normally.
                    _ = session.flush()
                    if !rawBefore.isEmpty { client.insertText(rawBefore, replacementRange: Self.noRange) }
                    hasMarkedText = false
                    correctionAnchor = nil
                    hideCandidates()
                    return false
                }
                replaceRange = verified
                // Clear marked text first if present so selectedRange sits right after committed text
                if EditContext.valid(context.marked) && context.marked.length > 0 {
                    client.setMarkedText("", selectionRange: empty, replacementRange: Self.noRange)
                    hasMarkedText = false
                }
            }

            if !commit.isEmpty || replaceRange.location != NSNotFound {
                client.insertText(commit, replacementRange: replaceRange)
                inserted = true
            }
        }

        if !view.preedit.isEmpty {
            let attr = NSMutableAttributedString(string: view.preedit)
            attr.addAttributes([
                .underlineStyle: NSUnderlineStyle.single.rawValue,
                .markedClauseSegment: 0
            ], range: NSRange(location: 0, length: attr.length))
            client.setMarkedText(attr, selectionRange: NSRange(location: attr.length, length: 0), replacementRange: Self.noRange)
            hasMarkedText = true
        } else {
            // insertText replaces the marked text; without an insert it has to be cleared explicitly.
            if hasMarkedText && !inserted {
                client.setMarkedText("", selectionRange: empty, replacementRange: Self.noRange)
            }
            hasMarkedText = false
        }

        let caretRect = (view.show || view.correction != nil) ? queryCaretScreenRect(client: client) : nil
        if !(view.show && !view.candidates.isEmpty) { dropHeld() }
        if view.show && !view.candidates.isEmpty, let caretRect = caretRect {
            if session.isScoring {
                hold(view, caretRect: caretRect)
            } else {
                dropHeld()
                CandidateWindowController.shared.showCandidates(view: view, caretRect: caretRect)
            }
        } else if let correction = view.correction, let caretRect = caretRect {
            let current = readContext(client: client)
            if current.canReplaceBefore && current.before.hasSuffix(correction.replacement) {
                correctionAnchor = current.selection.location
                CandidateWindowController.shared.showCorrection(correction, caretRect: caretRect)
            } else {
                hideCandidates()
            }
        } else {
            hideCandidates()
        }
        return true
    }

    override public func menu() -> NSMenu! {
        let menu = NSMenu(title: "Voka")
        let failure = session.failureReason.map { "Voka · \(Strings.current.passingThrough(SharedRuntime.firstLine($0)))" }
        let status = NSMenuItem(title: failure ?? SharedRuntime.engineStatus, action: nil, keyEquivalent: "")
        status.isEnabled = false
        menu.addItem(status)
        menu.addItem(.separator())
        // On or off only; the language is chosen in the settings window.
        let meanings = menu.addItem(withTitle: Strings.current.showMeanings, action: #selector(toggleMeanings(_:)), keyEquivalent: "")
        meanings.state = Settings.shared.showsMeanings ? .on : .off
        menu.addItem(withTitle: Strings.current.openSettings, action: #selector(showSettings(_:)), keyEquivalent: "")
        return menu
    }

    /// Input menu > Show Meanings
    @objc private func toggleMeanings(_ sender: Any?) {
        Settings.shared.toggleMeanings()
    }

    /// Input menu > Voka Settings…
    @objc private func showSettings(_ sender: Any?) {
        VokaWindowController.shared.show(reason: "input menu")
    }
}
