import Foundation
import XCTest
import VokaCore
@testable import VokaApp

final class SettingsTests: XCTestCase {
    private var suite = ""
    private var defaults: UserDefaults!

    override func setUp() {
        suite = "sh.pili.voka.tests.\(UUID().uuidString)"
        defaults = UserDefaults(suiteName: suite)
    }

    override func tearDown() {
        defaults.removePersistentDomain(forName: suite)
    }

    private func settings(_ languages: [String]) -> Settings {
        Settings(defaults: defaults, preferredLanguages: languages)
    }

    func testMeaningsStartInChineseOnlyForReadersOfChinese() {
        XCTAssertEqual(settings(["en-US"]).meanings, Settings.meaningsOff)
        XCTAssertEqual(settings(["ja-JP", "en"]).meanings, Settings.meaningsOff)
        XCTAssertEqual(settings([]).meanings, Settings.meaningsOff)
        XCTAssertEqual(settings(["zh-Hans-CN", "en"]).meanings, "zh-Hans")
        XCTAssertEqual(settings(["zh"]).meanings, "zh-Hans")
        // Chinese anywhere in the list counts, whatever the interface language is.
        XCTAssertEqual(settings(["en-GB", "zh-Hant-TW"]).meanings, "zh-Hans")
        XCTAssertFalse(settings(["en-US"]).showsMeanings)
        XCTAssertTrue(settings(["zh-Hans"]).showsMeanings)
    }

    func testTheMenuSwitchTurnsMeaningsOffAndBackOn() {
        let chinese = settings(["zh-Hans-CN"])
        chinese.toggleMeanings(preferredLanguages: ["zh-Hans-CN"])
        XCTAssertFalse(chinese.showsMeanings)
        chinese.toggleMeanings(preferredLanguages: ["en"])
        XCTAssertEqual(chinese.meanings, "zh-Hans")

        // Someone who starts without meanings gets the language there is.
        defaults.removePersistentDomain(forName: suite)
        let english = settings(["en-US"])
        XCTAssertFalse(english.showsMeanings)
        english.toggleMeanings(preferredLanguages: ["en-US"])
        XCTAssertEqual(english.meanings, "zh-Hans")
    }

    func testTheOtherSettingsStartOn() {
        let settings = settings(["en"])
        XCTAssertTrue(settings.localAI)
        XCTAssertTrue(settings.numberKeysPick)
    }

    func testDefaultsAreNotStoredUntilTheUserChoosesSomething() {
        _ = settings(["zh-Hans"])
        XCTAssertNil(defaults.object(forKey: Settings.Key.meanings))
        XCTAssertEqual(settings(["en"]).meanings, Settings.meaningsOff)
    }

    func testChangesAreSavedAtOnce() {
        let first = settings(["zh-Hans"])
        first.meanings = Settings.meaningsOff
        first.localAI = false
        first.numberKeysPick = false

        let second = settings(["zh-Hans"])
        XCTAssertEqual(second.meanings, Settings.meaningsOff)
        XCTAssertFalse(second.localAI)
        XCTAssertFalse(second.numberKeysPick)

        second.meanings = GlossLanguage.simplifiedChinese.code
        XCTAssertEqual(settings(["en"]).meanings, "zh-Hans")
    }

    func testAStoredLanguageTheDictionaryDoesNotHaveMeansOff() {
        defaults.set("xx", forKey: Settings.Key.meanings)
        XCTAssertEqual(settings(["zh-Hans"]).meanings, Settings.meaningsOff)
    }

    func testEveryGlossLanguageHasItsOwnCodeAndName() {
        XCTAssertFalse(GlossLanguage.available.isEmpty)
        XCTAssertEqual(Set(GlossLanguage.available.map(\.code)).count, GlossLanguage.available.count)
        for language in GlossLanguage.available {
            XCTAssertFalse(language.name.isEmpty)
            XCTAssertNotEqual(language.code, Settings.meaningsOff)
        }
    }

    func testTheFirstRunHappensOnce() {
        XCTAssertTrue(settings(["en"]).takeFirstRun())
        XCTAssertFalse(settings(["en"]).takeFirstRun())
    }

    func testEngineOptionsAreJSONTheEngineUnderstands() throws {
        for value in [true, false] {
            let json = Settings.engineOptionsJSON(numberKeysPick: value)
            let parsed = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Bool])
            XCTAssertEqual(parsed, ["numberKeysPick": value])
        }
        let settings = settings(["en"])
        settings.numberKeysPick = false
        XCTAssertEqual(settings.engineOptionsJSON, Settings.engineOptionsJSON(numberKeysPick: false))
    }

    // MARK: Local AI

    private final class FixedScorer: CandidateScorer {
        var calls = 0
        func scores(before: String, words: [String]) -> [String: Double]? {
            calls += 1
            return Dictionary(uniqueKeysWithValues: words.map { ($0, -1.0) })
        }
    }

    func testTheScorerAnswersOnlyWhileLocalAIIsOn() {
        let base = FixedScorer()
        let scorer = SwitchableScorer(base, isEnabled: false)
        XCTAssertNil(scorer.scores(before: "", words: ["a"]))
        XCTAssertEqual(base.calls, 0, "the model is not asked while the setting is off")
        scorer.isEnabled = true
        XCTAssertEqual(scorer.scores(before: "", words: ["a"]), ["a": -1.0])
        scorer.isEnabled = false
        XCTAssertNil(scorer.scores(before: "", words: ["a"]))
        XCTAssertEqual(base.calls, 1)
    }

    func testLocalAIStatus() {
        XCTAssertEqual(LocalAIStatus(isOn: false, model: .ready, isBundled: true), .off)
        XCTAssertEqual(LocalAIStatus(isOn: true, model: .ready, isBundled: true), .ready)
        XCTAssertEqual(LocalAIStatus(isOn: true, model: .notLoaded, isBundled: true), .loading)
        XCTAssertEqual(LocalAIStatus(isOn: true, model: .loading, isBundled: true), .loading)
        XCTAssertEqual(LocalAIStatus(isOn: true, model: .tooSlow, isBundled: true), .paused)
        XCTAssertEqual(LocalAIStatus(isOn: true, model: .failed("x"), isBundled: true), .unavailable)
        XCTAssertEqual(LocalAIStatus(isOn: true, model: .notLoaded, isBundled: false), .unavailable)
    }

    // MARK: Candidate window

    func testWithoutMeaningsTheWordAsTypedAloneIsNotShown() {
        func view(_ words: [String], hint: String = "") -> HostView {
            HostView(handled: true, preedit: "hello",
                     candidates: words.map { HostCandidate(word: $0, gloss: "你好", hint: hint) }, show: true)
        }
        XCTAssertFalse(CandidateWindowController.hasSomethingToSay(view(["hello"]), showsMeanings: false))
        XCTAssertTrue(CandidateWindowController.hasSomethingToSay(view(["hello"]), showsMeanings: true))
        XCTAssertTrue(CandidateWindowController.hasSomethingToSay(view(["Hello"]), showsMeanings: false))
        XCTAssertTrue(CandidateWindowController.hasSomethingToSay(view(["hello", "help"]), showsMeanings: false))
        XCTAssertTrue(CandidateWindowController.hasSomethingToSay(view(["hello"], hint: "a→an"), showsMeanings: false))
    }

    // MARK: Set-up

    func testManualStepsAppearOnlyWhenEnablingDidNotWork() {
        var state = InputSource.State.notEnabled
        var enableCalls = 0
        let setup = SetupModel(control: InputSourceControl(state: { state }, enable: { enableCalls += 1 }, select: {}))
        setup.refresh(now: Date().addingTimeInterval(60))
        XCTAssertFalse(setup.showsManualSteps, "not before the user asked to enable")

        setup.enable()
        XCTAssertEqual(enableCalls, 1)
        XCTAssertFalse(setup.showsManualSteps)
        setup.refresh(now: Date().addingTimeInterval(SetupModel.manualStepsDelay + 1))
        XCTAssertTrue(setup.showsManualSteps)

        state = .enabled(selected: false)
        setup.refresh(now: Date().addingTimeInterval(SetupModel.manualStepsDelay + 2))
        XCTAssertEqual(setup.state, .enabled(selected: false))
        XCTAssertFalse(setup.showsManualSteps)
    }

    func testAcknowledgementsAreParsedForTheWindow() {
        let blocks = Acknowledgements.parse("""
        # Title

        Built on the
        work of others.

        | Source | Terms |
        |---|---|
        | [CMU](https://x.y) | **BSD** |

        ## Licence texts

        - pluralize — Copyright

        ```text
        Line one
          line two
        ```
        """)
        XCTAssertEqual(blocks, [
            .text("Built on the work of others."),
            .row("CMU", ["BSD"]),
            .heading("Licence texts"),
            .item("pluralize — Copyright"),
            .licence("Line one\n  line two"),
        ])
    }
}
