import ApplicationServices
import Carbon
import Foundation

/// Voka's entry in the system's list of input sources, through the public Text Input Source API.
enum InputSource {
    enum State: Equatable {
        case notEnabled
        /// macOS reports the source as enabled, but this login session's input menu does not have it.
        /// It happens when Voka is removed while it is enabled and installed again: the session drops
        /// it, the user's permission stays. Removing and adding it in System Settings, or a new login
        /// session, puts it back in the menu; a program cannot.
        case needsLogin
        case enabled(selected: Bool)
    }

    static func string(_ source: TISInputSource, _ key: CFString) -> String? {
        guard let ptr = TISGetInputSourceProperty(source, key) else { return nil }
        return Unmanaged<CFString>.fromOpaque(ptr).takeUnretainedValue() as String
    }

    static func flag(_ source: TISInputSource, _ key: CFString) -> Bool {
        guard let ptr = TISGetInputSourceProperty(source, key) else { return false }
        return CFBooleanGetValue(Unmanaged<CFBoolean>.fromOpaque(ptr).takeUnretainedValue())
    }

    /// Every source that belongs to the bundle or carries its identifier, enabled or not.
    static func sources(_ bundleID: String) -> [TISInputSource] {
        let all = TISCreateInputSourceList(nil, true)?.takeRetainedValue() as? [TISInputSource] ?? []
        return all.filter {
            let id = string($0, kTISPropertyInputSourceID) ?? ""
            // Include sources that carry our identifier but are registered to another bundle.
            return string($0, kTISPropertyBundleID) == bundleID || id == bundleID || id.hasPrefix(bundleID + ".")
        }
    }

    static func sourceID(_ bundle: Bundle) -> String {
        bundle.object(forInfoDictionaryKey: "TISInputSourceID") as? String ?? bundle.bundleIdentifier ?? ""
    }

    /// The bundle's own source, if the system knows it.
    static func own(_ bundle: Bundle = .main) -> TISInputSource? {
        guard let bundleID = bundle.bundleIdentifier else { return nil }
        let id = sourceID(bundle)
        return sources(bundleID).first {
            string($0, kTISPropertyInputSourceID) == id && string($0, kTISPropertyBundleID) == bundleID
        }
    }

    static func state(_ bundle: Bundle = .main) -> State {
        guard let source = own(bundle), flag(source, kTISPropertyInputSourceIsEnabled) else { return .notEnabled }
        if let bundleID = bundle.bundleIdentifier, let menu = menuList(), !menu.isEmpty, !isListed(bundleID, in: menu) {
            return .needsLogin
        }
        return .enabled(selected: flag(source, kTISPropertyInputSourceIsSelected))
    }

    /// The input sources of the input menu, in menu order, as macOS publishes them for the menu and
    /// System Settings: a named pasteboard of the login session, not the clipboard. Nil when it cannot
    /// be read; the enabled flag is then all there is to go by.
    static func menuList() -> [[String: Any]]? {
        var board: Pasteboard?
        guard PasteboardCreate("AppleInputSourcesInUIOrderPasteboard" as CFString, &board) == noErr,
              let board else { return nil }
        PasteboardSynchronize(board)
        var count = 0
        guard PasteboardGetItemCount(board, &count) == noErr, count > 0 else { return nil }
        var item: PasteboardItemID?
        guard PasteboardGetItemIdentifier(board, 1, &item) == noErr, let item else { return nil }
        var data: CFData?
        guard PasteboardCopyItemFlavorData(board, item, "AppleInputSourcesInUIOrderFlavor" as CFString, &data) == noErr,
              let data = data as Data? else { return nil }
        return (try? PropertyListSerialization.propertyList(from: data, format: nil)) as? [[String: Any]]
    }

    /// Is the input method of this bundle in a list of input sources such as `menuList()`?
    static func isListed(_ bundleID: String, in list: [[String: Any]]) -> Bool {
        list.contains { $0["Bundle ID"] as? String == bundleID && $0["InputSourceKind"] as? String == "Keyboard Input Method" }
    }

    /// Ask the system to add the source to the user's input sources, registering the bundle first when
    /// the system does not know it yet. macOS may ask the user to confirm.
    @discardableResult
    static func enable(_ bundle: Bundle = .main) -> OSStatus {
        if own(bundle) == nil {
            let registered = TISRegisterInputSource(bundle.bundleURL as CFURL)
            if registered != noErr { return registered }
        }
        guard let source = own(bundle) else { return OSStatus(paramErr) }
        return TISEnableInputSource(source)
    }

    /// Make the source the current one. It has to be enabled.
    @discardableResult
    static func select(_ bundle: Bundle = .main) -> OSStatus {
        // Selecting a source the menu does not have leaves the menu showing another source as current.
        guard case .enabled = state(bundle), let source = own(bundle) else { return OSStatus(paramErr) }
        return TISSelectInputSource(source)
    }
}
