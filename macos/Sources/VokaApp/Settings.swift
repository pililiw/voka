import Combine
import Foundation
import VokaCore

/// A language the dictionary has meanings in. `name` is the language's own name, shown as it is
/// whatever the interface language.
struct GlossLanguage: Equatable, Identifiable {
    let code: String
    let name: String
    var id: String { code }

    static let simplifiedChinese = GlossLanguage(code: "zh-Hans", name: "简体中文")

    /// The languages the bundled dictionary carries.
    static let available = [simplifiedChinese]

    /// The language to start with: the first available one the user reads, if any.
    static func preferred(among preferredLanguages: [String]) -> GlossLanguage? {
        let codes = preferredLanguages.map { $0.lowercased() }
        return available.first { language in
            let base = language.code.split(separator: "-").first.map { $0.lowercased() } ?? language.code
            return codes.contains { $0 == base || $0.hasPrefix(base + "-") }
        }
    }
}

/// The user's settings. A change is saved and published at once; nothing needs a restart.
/// Use from the main thread.
final class Settings: ObservableObject {
    static let shared = Settings()

    enum Key {
        static let meanings = "meanings"
        static let localAI = "localAI"
        static let numberKeysPick = "numberKeysPick"
        static let windowShown = "windowShown"
        static let lastMeanings = "lastMeanings"
    }

    /// The stored value of `meanings` when no meanings are shown.
    static let meaningsOff = "off"

    private let defaults: UserDefaults

    /// Code of the language meanings are shown in, or `meaningsOff`.
    @Published var meanings: String {
        didSet {
            defaults.set(meanings, forKey: Key.meanings)
            if meanings != Self.meaningsOff { defaults.set(meanings, forKey: Key.lastMeanings) }
        }
    }
    /// Whether the on-device language model reads the sentence.
    @Published var localAI: Bool { didSet { defaults.set(localAI, forKey: Key.localAI) } }
    /// Whether digits pick the numbered candidate.
    @Published var numberKeysPick: Bool { didSet { defaults.set(numberKeysPick, forKey: Key.numberKeysPick) } }

    init(defaults: UserDefaults = .standard, preferredLanguages: [String] = Locale.preferredLanguages) {
        self.defaults = defaults
        let stored = defaults.string(forKey: Key.meanings)
        if let stored = stored, GlossLanguage.available.contains(where: { $0.code == stored }) {
            meanings = stored
        } else if stored != nil {
            meanings = Self.meaningsOff
        } else {
            meanings = GlossLanguage.preferred(among: preferredLanguages)?.code ?? Self.meaningsOff
        }
        localAI = defaults.object(forKey: Key.localAI) as? Bool ?? true
        numberKeysPick = defaults.object(forKey: Key.numberKeysPick) as? Bool ?? true
    }

    var showsMeanings: Bool { meanings != Self.meaningsOff }

    /// Turn meanings off, or back on in the language they were last shown in (failing that, the
    /// language that suits the user, then the first one there is).
    func toggleMeanings(preferredLanguages: [String] = Locale.preferredLanguages) {
        guard !showsMeanings else {
            meanings = Self.meaningsOff
            return
        }
        let last = defaults.string(forKey: Key.lastMeanings)
        let known = GlossLanguage.available.first { $0.code == last }
        meanings = (known ?? GlossLanguage.preferred(among: preferredLanguages) ?? GlossLanguage.available.first)?.code
            ?? Self.meaningsOff
    }

    /// The engine options these settings stand for, as `JSEngine.setOptions` takes them.
    var engineOptionsJSON: String { Self.engineOptionsJSON(numberKeysPick: numberKeysPick) }

    static func engineOptionsJSON(numberKeysPick: Bool) -> String { #"{"numberKeysPick": \#(numberKeysPick)}"# }

    /// True once: the first time the application runs for this user.
    func takeFirstRun() -> Bool {
        if defaults.bool(forKey: Key.windowShown) { return false }
        defaults.set(true, forKey: Key.windowShown)
        return true
    }
}

/// Passes requests to `base` while enabled and has no opinion otherwise, so sessions that already
/// exist follow the Local AI setting.
final class SwitchableScorer: CandidateScorer {
    private let base: CandidateScorer
    private let lock = NSLock()
    private var enabled: Bool

    init(_ base: CandidateScorer, isEnabled: Bool) {
        self.base = base
        enabled = isEnabled
    }

    var isEnabled: Bool {
        get { lock.lock(); defer { lock.unlock() }; return enabled }
        set { lock.lock(); enabled = newValue; lock.unlock() }
    }

    func scores(before: String, words: [String]) -> [String: Double]? {
        isEnabled ? base.scores(before: before, words: words) : nil
    }
}
