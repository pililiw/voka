import Carbon
import Foundation

/// Voka's entry in the system's list of input sources, through the public Text Input Source API.
enum InputSource {
    enum State: Equatable {
        case notEnabled
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
        return .enabled(selected: flag(source, kTISPropertyInputSourceIsSelected))
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
        guard let source = own(bundle), flag(source, kTISPropertyInputSourceIsEnabled) else { return OSStatus(paramErr) }
        return TISSelectInputSource(source)
    }
}
