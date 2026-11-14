import Foundation

/// Every user-visible string. One value of this type is one language; adding a language is adding
/// one more value and listing it in `Strings.tables`. `%@` marks where a value is inserted.
struct StringTable {
    // Candidate window
    let space: String
    let correctedTo: String
    let restore: String

    // Input menu
    let passingThrough: String
    let modelStatusLoading: String
    let modelStatusReady: String
    let modelStatusLatency: String
    let modelStatusSlow: String
    let modelStatusUnavailable: String
    let openSettings: String
    let showMeanings: String

    // Window: header
    let tagline: String
    let version: String

    // Window: set-up
    let enablePrompt: String
    let enableButton: String
    let enableNote: String
    let manualIntro: String
    let manualStep1: String
    let manualStep2: String
    let manualStep3: String
    let openKeyboardSettings: String
    let ready: String
    let howToSwitch: String
    let switchToVoka: String

    // Window: try it
    let tryIt: String
    let tryPlaceholder: String
    let keyReminder: String
    let keyReminderWithoutNumbers: String

    // Window: settings
    let settings: String
    let meanings: String
    let meaningsDetail: String
    let meaningsOff: String
    let localAI: String
    let localAIDetail: String
    let modelReady: String
    let modelLoading: String
    let modelOff: String
    let modelPaused: String
    let modelUnavailable: String
    let numberKeys: String
    let numberKeysDetail: String

    // Window: footer
    let privacy: String
    let acknowledgements: String
    let done: String
}

extension StringTable {
    static let english = StringTable(
        space: "Space",
        correctedTo: "Corrected to %@",
        restore: "Restore %@",

        passingThrough: "engine unavailable, keys pass through (%@)",
        modelStatusLoading: "Local AI loading",
        modelStatusReady: "Local AI ready",
        modelStatusLatency: "Local AI %@ ms",
        modelStatusSlow: "Local AI paused (%@ ms)",
        modelStatusUnavailable: "Local AI unavailable (%@)",
        openSettings: "Voka Settings…",
        showMeanings: "Show Meanings",

        tagline: "An English input method that finds the word you meant.",
        version: "Version %@",

        enablePrompt: "Add Voka to your input sources to start typing with it.",
        enableButton: "Enable Voka",
        enableNote: "macOS may ask you to confirm.",
        manualIntro: "Still not enabled? Add Voka by hand:",
        manualStep1: "Open System Settings → Keyboard → Text Input → Edit…",
        manualStep2: "Click +, choose English, select Voka and click Add.",
        manualStep3: "Choose Allow when macOS asks.",
        openKeyboardSettings: "Open Keyboard Settings",
        ready: "Voka is ready",
        howToSwitch: "Choose Voka from the input menu in the menu bar. Control-Space switches between your last two input sources.",
        switchToVoka: "Switch to Voka",

        tryIt: "Try it",
        tryPlaceholder: "Try: I recieve the mesage yestarday",
        keyReminder: "Space commits · Tab takes the suggestion · arrows or number keys choose",
        keyReminderWithoutNumbers: "Space commits · Tab takes the suggestion · arrows choose",

        settings: "Settings",
        meanings: "Meanings",
        meaningsDetail: "A short meaning next to each candidate.",
        meaningsOff: "Off",
        localAI: "Local AI",
        localAIDetail: "Reads the sentence on this Mac to choose the right word. %@",
        modelReady: "Model ready.",
        modelLoading: "Model loading…",
        modelOff: "Model off.",
        modelPaused: "Paused while this Mac is busy; it resumes by itself.",
        modelUnavailable: "Model not available on this Mac.",
        numberKeys: "Number keys pick candidates",
        numberKeysDetail: "Press a number to pick the candidate it is shown with.",

        privacy: "Privacy: everything stays on this Mac",
        acknowledgements: "Acknowledgements",
        done: "Done"
    )

    static let simplifiedChinese = StringTable(
        space: "空格",
        correctedTo: "已纠正为 %@",
        restore: "恢复 %@",

        passingThrough: "引擎不可用，按键原样输入（%@）",
        modelStatusLoading: "本地 AI 加载中",
        modelStatusReady: "本地 AI 已就绪",
        modelStatusLatency: "本地 AI %@ ms",
        modelStatusSlow: "本地 AI 已暂停（%@ ms）",
        modelStatusUnavailable: "本地 AI 不可用（%@）",
        openSettings: "Voka 设置…",
        showMeanings: "显示释义",

        tagline: "帮你找到想写的那个词的英文输入法。",
        version: "版本 %@",

        enablePrompt: "把 Voka 添加到输入法后即可开始使用。",
        enableButton: "启用 Voka",
        enableNote: "macOS 可能会请你确认。",
        manualIntro: "仍未启用？请手动添加 Voka：",
        manualStep1: "打开 系统设置 → 键盘 → 文字输入 → 编辑…",
        manualStep2: "点按 +，选择“英语”，选中 Voka 并点按“添加”。",
        manualStep3: "macOS 询问时选择“允许”。",
        openKeyboardSettings: "打开键盘设置",
        ready: "Voka 已就绪",
        howToSwitch: "在菜单栏的输入法菜单中选择 Voka。按 Control-空格 可在最近使用的两个输入法之间切换。",
        switchToVoka: "切换到 Voka",

        tryIt: "试一试",
        tryPlaceholder: "试着输入：I recieve the mesage yestarday",
        keyReminder: "空格上屏 · Tab 采用建议 · 方向键或数字键选择",
        keyReminderWithoutNumbers: "空格上屏 · Tab 采用建议 · 方向键选择",

        settings: "设置",
        meanings: "释义",
        meaningsDetail: "在每个候选词旁显示简短的释义。",
        meaningsOff: "关闭",
        localAI: "本地 AI",
        localAIDetail: "在这台 Mac 上读懂整句，选出合适的词。%@",
        modelReady: "模型已就绪。",
        modelLoading: "模型加载中…",
        modelOff: "模型已关闭。",
        modelPaused: "这台 Mac 较忙，已暂停，稍后会自动恢复。",
        modelUnavailable: "模型在这台 Mac 上不可用。",
        numberKeys: "数字键选词",
        numberKeysDetail: "按数字键选择对应编号的候选词。",

        privacy: "隐私：所有内容都留在这台 Mac 上",
        acknowledgements: "致谢与许可",
        done: "完成"
    )
}

extension StringTable {
    private func fill(_ template: String, _ value: String) -> String {
        template.replacingOccurrences(of: "%@", with: value)
    }

    func corrected(to word: String) -> String { fill(correctedTo, word) }
    func restore(_ word: String) -> String { fill(restore, word) }
    func passingThrough(_ reason: String) -> String { fill(passingThrough, reason) }
    func modelStatusLatency(_ milliseconds: Double) -> String { fill(modelStatusLatency, String(format: "%.0f", milliseconds)) }
    func modelStatusSlow(_ milliseconds: Double) -> String { fill(modelStatusSlow, String(format: "%.0f", milliseconds)) }
    func modelStatusUnavailable(_ reason: String) -> String { fill(modelStatusUnavailable, reason) }
    func localAIDetail(_ modelState: String) -> String { fill(localAIDetail, modelState) }
    func version(_ number: String) -> String { fill(version, number) }
}

enum Strings {
    /// The languages of the interface, by language code. English is the base language.
    static let tables: [(language: String, table: StringTable)] = [
        ("en", .english),
        ("zh", .simplifiedChinese)
    ]

    /// The table of the first preferred language that has one; English when none has.
    static func table(for preferredLanguages: [String]) -> StringTable {
        for preferred in preferredLanguages {
            let code = preferred.lowercased()
            if let match = tables.first(where: { code == $0.language || code.hasPrefix($0.language + "-") }) {
                return match.table
            }
        }
        return .english
    }

    static let current = table(for: Locale.preferredLanguages)
}
