import Cocoa
import Carbon
import InputMethodKit
import VokaCore

/// Maintenance commands (`--validate-bundle`, `--input-source-status`, `--language-model-status`,
/// `--register-input-source`, `--select-input-source`), handled before the application starts. They use only the public Text
/// Input Source API and never edit the user's input-source preferences.
enum InputSourceCommands {
    private static func currentID() -> String? {
        guard let source = TISCopyCurrentKeyboardInputSource()?.takeRetainedValue() else { return nil }
        return InputSource.string(source, kTISPropertyInputSourceID)
    }

    private static func output(_ value: [String: Any]) {
        if let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]),
           let text = String(data: data, encoding: .utf8) { print(text) }
    }

    private static func status(_ bundle: Bundle, result: OSStatus? = nil) {
        let bundleID = bundle.bundleIdentifier ?? ""
        let sourceID = bundle.object(forInfoDictionaryKey: "TISInputSourceID") as? String ?? bundleID
        let entries: [[String: Any]] = InputSource.sources(bundleID).map { source in
            ["id": InputSource.string(source, kTISPropertyInputSourceID) ?? "",
             "bundleID": InputSource.string(source, kTISPropertyBundleID) ?? "",
             "type": InputSource.string(source, kTISPropertyInputSourceType) ?? "",
             "enabled": InputSource.flag(source, kTISPropertyInputSourceIsEnabled),
             "selectable": InputSource.flag(source, kTISPropertyInputSourceIsSelectCapable),
             "selected": InputSource.flag(source, kTISPropertyInputSourceIsSelected)]
        }
        let ready = entries.contains {
            $0["id"] as? String == sourceID && $0["bundleID"] as? String == bundleID
                && $0["enabled"] as? Bool == true && $0["selectable"] as? Bool == true
        }
        var report: [String: Any] = [
            "bundlePath": bundle.bundlePath, "bundleID": bundleID, "sourceID": sourceID,
            "version": bundle.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "",
            "build": bundle.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "",
            "ready": ready, "currentSourceID": currentID() ?? "", "sources": entries
        ]
        if let result = result { report["result"] = result }
        output(report)
    }

    /// Check the packaged executable and Info.plist without starting an input server or changing
    /// any input-source state.
    private static func validate(_ bundle: Bundle) -> Int32 {
        var errors: [String] = []
        let info = bundle.infoDictionary ?? [:]
        let bundleID = bundle.bundleIdentifier ?? ""
        if bundleID.isEmpty || info["TISInputSourceID"] as? String != bundleID {
            errors.append("The single input source must use the app bundle identifier")
        }
        if info["ComponentInputModeDict"] != nil {
            errors.append("Voka has one English source, not a parent with child modes")
        }
        if info["LSUIElement"] as? Bool != true || info["LSBackgroundOnly"] as? Bool == true {
            errors.append("The input method must be a Cocoa UI-element app")
        }
        if (info["InputMethodConnectionName"] as? String)?.isEmpty != false {
            errors.append("InputMethodConnectionName is missing")
        }
        if info["tsInputMethodCharacterRepertoireKey"] as? [String] != ["Latn"] {
            errors.append("The English input source must declare the Latn repertoire")
        }
        if let name = info["InputMethodServerControllerClass"] as? String,
           let type = NSClassFromString(name) as? IMKInputController.Type {
            _ = type
        } else {
            errors.append("InputMethodServerControllerClass is not linked into this executable")
        }
        for (name, ext) in [("engine", "js"), ("dict", "json"), ("lm", "mlmodelc"), ("lm-tokenizer", "json"),
                            ("Voka", "icns"), ("MenuIcon", "pdf"), ("THIRD_PARTY_NOTICES", "md")] {
            if bundle.url(forResource: name, withExtension: ext) == nil {
                errors.append("Missing resource: \(name).\(ext)")
            }
        }
        output(["bundleValid": errors.isEmpty, "errors": errors, "bundlePath": bundle.bundlePath])
        return errors.isEmpty ? 0 : 1
    }

    /// Load the language model in this process and time a series of requests.
    private static func languageModelStatus(_ bundle: Bundle) -> Int32 {
        guard let model = bundle.url(forResource: "lm", withExtension: "mlmodelc"),
              let tokenizer = bundle.url(forResource: "lm-tokenizer", withExtension: "json") else {
            output(["state": "missing"])
            return 1
        }
        LanguageModel.shared.load(modelURL: model, tokenizerURL: tokenizer)
        for _ in 0..<30 {
            Thread.sleep(forTimeInterval: 0.05)
            _ = LanguageModel.shared.scores(before: "Because of the bad ", words: ["wether", "weather", "whether"])
        }
        let latency = LanguageModel.shared.latency
        output(["state": String(describing: LanguageModel.shared.state),
                "medianMs": (latency?.median ?? 0).rounded(), "p95Ms": (latency?.p95 ?? 0).rounded(),
                "limitMs": LanguageModel.defaultLatencyLimitMs])
        return 0
    }

    static func run(arguments: [String], bundle: Bundle = .main) -> Int32? {
        guard arguments.count > 1 else { return nil }
        let command = arguments[1]
        if command == "--validate-bundle" { return validate(bundle) }
        if command == "--input-source-status" { status(bundle); return 0 }
        if command == "--language-model-status" { return languageModelStatus(bundle) }
        guard command == "--register-input-source" || command == "--select-input-source" else { return nil }
        guard let bundleID = bundle.bundleIdentifier else { return 1 }
        let sourceID = bundle.object(forInfoDictionaryKey: "TISInputSourceID") as? String ?? bundleID
        let source = InputSource.sources(bundleID).first { InputSource.string($0, kTISPropertyInputSourceID) == sourceID }
        if command == "--register-input-source" {
            // A valid, selectable source is not registered again.
            if let source = source, InputSource.string(source, kTISPropertyBundleID) == bundleID,
               InputSource.flag(source, kTISPropertyInputSourceIsSelectCapable) {
                status(bundle, result: noErr)
                return 0
            }
            let result = TISRegisterInputSource(bundle.bundleURL as CFURL)
            status(bundle, result: result)
            return result == noErr ? 0 : 1
        }
        guard let source = source,
              InputSource.string(source, kTISPropertyBundleID) == bundleID,
              InputSource.flag(source, kTISPropertyInputSourceIsEnabled),
              InputSource.flag(source, kTISPropertyInputSourceIsSelectCapable) else {
            status(bundle, result: OSStatus(paramErr))
            return 2
        }
        let result = TISSelectInputSource(source)
        status(bundle, result: result)
        return result == noErr && currentID() == sourceID ? 0 : 1
    }
}
