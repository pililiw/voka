import Cocoa
import os
import SwiftUI
import VokaCore

/// How the window reads and changes the state of the input source. The debug preview replaces it
/// with a stand-in that leaves the system alone.
struct InputSourceControl {
    var state: () -> InputSource.State
    var enable: () -> Void
    var select: () -> Void

    static let system = InputSourceControl(
        state: { InputSource.state() },
        enable: { InputSource.enable() },
        select: { InputSource.select() }
    )
}

/// What the window says about the language model.
enum LocalAIStatus: Equatable {
    case off, loading, ready, paused, unavailable

    init(isOn: Bool, model: LanguageModel.State, isBundled: Bool) {
        if !isOn {
            self = .off
        } else if !isBundled {
            self = .unavailable
        } else {
            switch model {
            case .ready: self = .ready
            case .notLoaded, .loading: self = .loading
            case .tooSlow: self = .paused
            case .failed: self = .unavailable
            }
        }
    }
}

/// The live part of the window: whether Voka is enabled and selected, and the state of the model.
/// It looks once a second for as long as it exists, which is while the window is open.
final class SetupModel: ObservableObject {
    /// How long after Enable the manual steps appear if the source is still not enabled.
    static let manualStepsDelay: TimeInterval = 4

    @Published private(set) var state: InputSource.State
    @Published private(set) var showsManualSteps = false
    @Published private(set) var modelState: LanguageModel.State

    private let control: InputSourceControl
    private var enableRequestedAt: Date?
    private var timer: Timer?

    init(control: InputSourceControl = .system) {
        self.control = control
        state = control.state()
        modelState = LanguageModel.shared.state
        let timer = Timer(timeInterval: 1, repeats: true) { [weak self] _ in self?.refresh() }
        RunLoop.main.add(timer, forMode: .common)
        self.timer = timer
    }

    deinit { timer?.invalidate() }

    func refresh(now: Date = Date()) {
        let current = control.state()
        if current != state { state = current }
        let manual = current == .notEnabled
            && enableRequestedAt.map { now.timeIntervalSince($0) >= Self.manualStepsDelay } == true
        if manual != showsManualSteps { showsManualSteps = manual }
        let model = LanguageModel.shared.state
        if model != modelState { modelState = model }
    }

    func enable() {
        enableRequestedAt = Date()
        control.enable()
        refresh()
    }

    func select() {
        control.select()
        refresh()
    }
}

struct VokaWindowView: View {
    @ObservedObject var settings: Settings
    @ObservedObject var setup: SetupModel
    @State private var sample = ""
    @State private var showsAcknowledgements = false
    @State private var hoversAcknowledgements = false
    @State private var hoversWebsite = false

    private let strings = Strings.current
    static let width: CGFloat = 460

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            header
            Divider()
            setUp
            Divider()
            tryIt
            Divider()
            settingsList
            Divider()
            footer
        }
        .padding(20)
        .frame(width: Self.width)
    }

    private var header: some View {
        HStack(spacing: 14) {
            Image(nsImage: NSApp.applicationIconImage)
                .resizable()
                .frame(width: 64, height: 64)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 3) {
                Text(verbatim: "Voka").font(.title.weight(.semibold))
                Text(strings.tagline)
                Text(strings.version(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "–"))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
        }
    }

    @ViewBuilder private var setUp: some View {
        switch setup.state {
        case .notEnabled:
            VStack(alignment: .leading, spacing: 10) {
                Text(strings.enablePrompt)
                Button(strings.enableButton) { setup.enable() }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    .keyboardShortcut(.defaultAction)
                detail(strings.enableNote)
                if setup.showsManualSteps {
                    VStack(alignment: .leading, spacing: 5) {
                        Text(strings.manualIntro)
                        ForEach(Array([strings.manualStep1, strings.manualStep2, strings.manualStep3].enumerated()), id: \.offset) { step in
                            HStack(alignment: .firstTextBaseline, spacing: 6) {
                                Text(verbatim: "\(step.offset + 1).").monospacedDigit()
                                Text(step.element).fixedSize(horizontal: false, vertical: true)
                            }
                        }
                        Button(strings.openKeyboardSettings) {
                            if let url = URL(string: "x-apple.systempreferences:com.apple.Keyboard-Settings.extension") {
                                NSWorkspace.shared.open(url)
                            }
                        }
                        .padding(.top, 4)
                    }
                    .padding(.top, 4)
                }
            }
        case .enabled(let selected):
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: "checkmark.circle.fill")
                    .font(.title2)
                    .foregroundStyle(.green)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 4) {
                    Text(strings.ready).font(.headline)
                    detail(strings.howToSwitch)
                    if !selected {
                        Button(strings.switchToVoka) { setup.select() }
                            .padding(.top, 4)
                    }
                }
            }
        }
    }

    private var tryIt: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(strings.tryIt).font(.headline)
            TextField(strings.tryPlaceholder, text: $sample, axis: .vertical)
                .lineLimit(3...3)
                .textFieldStyle(.roundedBorder)
                .accessibilityLabel(strings.tryIt)
            detail(settings.numberKeysPick ? strings.keyReminder : strings.keyReminderWithoutNumbers)
        }
    }

    private var settingsList: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(strings.settings).font(.headline)
            setting(strings.meanings, strings.meaningsDetail) {
                Picker(strings.meanings, selection: $settings.meanings) {
                    Text(strings.meaningsOff).tag(Settings.meaningsOff)
                    ForEach(GlossLanguage.available) { language in
                        Text(verbatim: language.name).tag(language.code)
                    }
                }
                .labelsHidden()
                .fixedSize()
            }
            setting(strings.localAI, strings.localAIDetail(localAIStatus)) {
                Toggle(strings.localAI, isOn: $settings.localAI)
            }
            setting(strings.numberKeys, strings.numberKeysDetail) {
                Toggle(strings.numberKeys, isOn: $settings.numberKeysPick)
            }
        }
        .toggleStyle(.switch)
        .labelsHidden()
    }

    private var localAIStatus: String {
        switch LocalAIStatus(isOn: settings.localAI, model: setup.modelState, isBundled: SharedRuntime.languageModelFiles != nil) {
        case .off: return strings.modelOff
        case .loading: return strings.modelLoading
        case .ready: return strings.modelReady
        case .paused: return strings.modelPaused
        case .unavailable: return strings.modelUnavailable
        }
    }

    /// What matters to the user first (nothing leaves the Mac), then the acknowledgements and the website.
    private var footer: some View {
        HStack(spacing: 6) {
            Image(systemName: "lock.shield")
            Text(strings.privacy)
            Spacer()
            if Acknowledgements.blocks != nil {
                // Quiet until the pointer is over it: few people need it, but it should feel clickable.
                Button(strings.acknowledgements) { showsAcknowledgements = true }
                    .buttonStyle(.plain)
                    .underline(hoversAcknowledgements)
                    .foregroundStyle(hoversAcknowledgements ? .primary : .secondary)
                    .onHover { hoversAcknowledgements = $0 }
                Text("·")
            }
            if let url = URL(string: "https://pili.sh") {
                Link(destination: url) {
                    // The arrow marks it as a link that leaves the app.
                    HStack(spacing: 2) {
                        Text("pili.sh").underline(hoversWebsite)
                        Image(systemName: "arrow.up.right").imageScale(.small)
                    }
                }
                // The one coloured item in the footer: it is the only thing here that leads somewhere.
                .foregroundStyle(Color.accentColor)
                .onHover { hoversWebsite = $0 }
            }
        }
        .font(.subheadline)
        .foregroundStyle(.secondary)
        .sheet(isPresented: $showsAcknowledgements) {
            AcknowledgementsView(blocks: Acknowledgements.blocks ?? [], strings: strings) {
                showsAcknowledgements = false
            }
        }
    }

    private func detail(_ text: String) -> some View {
        Text(text)
            .font(.subheadline)
            .foregroundStyle(.secondary)
            .fixedSize(horizontal: false, vertical: true)
    }

    private func setting<Control: View>(_ title: String, _ detailText: String, @ViewBuilder control: () -> Control) -> some View {
        HStack(alignment: .center, spacing: 16) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                detail(detailText)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            control()
        }
    }
}

/// Shows the one window. Opening it does not touch the input method server, and closing it leaves
/// the application running.
final class VokaWindowController: NSObject, NSWindowDelegate {
    static let shared = VokaWindowController()

    private var window: NSWindow?

    static func makeWindow(control: InputSourceControl = .system) -> NSWindow {
        let host = NSHostingController(rootView: VokaWindowView(settings: .shared, setup: SetupModel(control: control)))
        host.sizingOptions = [.preferredContentSize]
        let window = NSWindow(contentViewController: host)
        window.styleMask = [.titled, .closable]
        window.title = "Voka"
        window.isReleasedWhenClosed = false
        return window
    }

    /// `reason` goes to the log: it says what opened the window.
    func show(reason: String, control: InputSourceControl = .system) {
        os_log("Voka: showing the window (%{public}@)", reason)
        if window == nil {
            let created = Self.makeWindow(control: control)
            created.delegate = self
            created.center()
            window = created
        }
        NSApp.activate(ignoringOtherApps: true)
        window?.makeKeyAndOrderFront(nil)
        window?.orderFrontRegardless()
    }

    func windowWillClose(_ notification: Notification) {
        // Dropping the window ends the once-a-second look at the input source.
        window = nil
    }

    /// An accessory application has no menu bar, but its main menu still supplies the standard
    /// shortcuts: ⌘W for the window, and editing in the text field.
    static func makeMainMenu() -> NSMenu {
        let main = NSMenu()
        func add(_ title: String, _ items: [(String, Selector, String, NSEvent.ModifierFlags)]) {
            let menu = NSMenu(title: title)
            for (name, action, key, modifiers) in items {
                menu.addItem(withTitle: name, action: action, keyEquivalent: key).keyEquivalentModifierMask = modifiers
            }
            let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
            item.submenu = menu
            main.addItem(item)
        }
        add("Voka", [])
        add("File", [("Close Window", #selector(NSWindow.performClose(_:)), "w", .command)])
        add("Edit", [
            ("Undo", Selector(("undo:")), "z", .command),
            ("Redo", Selector(("redo:")), "z", [.command, .shift]),
            ("Cut", #selector(NSText.cut(_:)), "x", .command),
            ("Copy", #selector(NSText.copy(_:)), "c", .command),
            ("Paste", #selector(NSText.paste(_:)), "v", .command),
            ("Select All", #selector(NSText.selectAll(_:)), "a", .command)
        ])
        return main
    }
}

#if DEBUG
/// Debug builds only: `VokaIME --preview-window[=not-enabled|manual|enabled|selected|acknowledgements]` shows the
/// window with a stand-in for the input source, so every set-up state can be looked at without
/// changing the system's input sources. `--snapshot <file.png>` writes the window's content to a
/// file and exits instead; `--dark` uses the dark appearance. Neither starts an input method server: this returns before one is
/// created, so the preview can run next to the installed Voka, and from the build folder.
enum WindowPreview {
    static func run(arguments: [String]) -> Int32? {
        guard let option = arguments.dropFirst().first(where: { $0.hasPrefix("--preview-window") }) else { return nil }
        let name = option.split(separator: "=", maxSplits: 1).dropFirst().first.map(String.init) ?? "not-enabled"

        var state: InputSource.State
        switch name {
        case "enabled": state = .enabled(selected: false)
        case "selected": state = .enabled(selected: true)
        default: state = .notEnabled
        }
        let control = InputSourceControl(
            state: { state },
            enable: {},
            select: { state = .enabled(selected: true) }
        )

        let app = NSApplication.shared
        app.setActivationPolicy(.regular)
        if arguments.contains("--dark") { app.appearance = NSAppearance(named: .darkAqua) }
        app.mainMenu = VokaWindowController.makeMainMenu()

        if name == "acknowledgements", let flag = arguments.firstIndex(of: "--snapshot"), arguments.indices.contains(flag + 1) {
            // The bare binary has no bundle: read the notices from the repository root.
            let markdown = (try? String(contentsOfFile: "THIRD_PARTY_NOTICES.md", encoding: .utf8)) ?? ""
            let view = NSHostingView(rootView: AcknowledgementsView(blocks: Acknowledgements.parse(markdown), strings: Strings.current) {}
                .background(Color(nsColor: .windowBackgroundColor)))
            view.frame = NSRect(origin: .zero, size: view.fittingSize)
            let window = NSWindow(contentRect: view.frame, styleMask: [.titled], backing: .buffered, defer: false)
            window.contentView = view
            view.layoutSubtreeIfNeeded()
            RunLoop.main.run(until: Date().addingTimeInterval(0.3))
            guard let image = view.bitmapImageRepForCachingDisplay(in: view.bounds) else { return 1 }
            view.cacheDisplay(in: view.bounds, to: image)
            guard let png = image.representation(using: .png, properties: [:]) else { return 1 }
            return (try? png.write(to: URL(fileURLWithPath: arguments[flag + 1]))) == nil ? 1 : 0
        }
        if let flag = arguments.firstIndex(of: "--snapshot"), arguments.indices.contains(flag + 1) {
            let setup = SetupModel(control: control)
            if name == "manual" {
                setup.enable()
                setup.refresh(now: Date().addingTimeInterval(SetupModel.manualStepsDelay))
            }
            let view = NSHostingView(rootView: VokaWindowView(settings: .shared, setup: setup)
                .background(Color(nsColor: .windowBackgroundColor)))
            view.frame = NSRect(origin: .zero, size: view.fittingSize)
            let window = NSWindow(contentRect: view.frame, styleMask: [.titled], backing: .buffered, defer: false)
            window.contentView = view
            view.layoutSubtreeIfNeeded()
            RunLoop.main.run(until: Date().addingTimeInterval(0.3))
            guard let image = view.bitmapImageRepForCachingDisplay(in: view.bounds) else { return 1 }
            view.cacheDisplay(in: view.bounds, to: image)
            guard let png = image.representation(using: .png, properties: [:]) else { return 1 }
            do {
                try png.write(to: URL(fileURLWithPath: arguments[flag + 1]))
            } catch {
                return 1
            }
            return 0
        }

        // The stand-in never becomes enabled: after Enable the manual steps appear as they would.
        VokaWindowController.shared.show(reason: "preview", control: control)
        NotificationCenter.default.addObserver(forName: NSWindow.willCloseNotification, object: nil, queue: .main) { _ in
            exit(0)
        }
        app.run()
        return 0
    }
}
#endif

/// The bundled acknowledgements (`THIRD_PARTY_NOTICES.md`), parsed for the window.
enum Acknowledgements {
    enum Block: Equatable {
        case heading(String)
        case text(String)
        case item(String)
        /// A table row: its first cell, and the remaining cells.
        case row(String, [String])
        /// A licence text, kept line by line.
        case licence(String)
    }

    static let blocks: [Block]? = {
        guard let url = Bundle.main.url(forResource: "THIRD_PARTY_NOTICES", withExtension: "md"),
              let markdown = try? String(contentsOf: url, encoding: .utf8) else { return nil }
        return parse(markdown)
    }()

    private static func inline(_ text: String) -> String {
        text.replacingOccurrences(of: #"\[([^\]]+)\]\(([^)]+)\)"#, with: "$1", options: .regularExpression)
            .replacingOccurrences(of: "**", with: "")
            .replacingOccurrences(of: "*", with: "")
            .replacingOccurrences(of: "`", with: "")
            .trimmingCharacters(in: .whitespaces)
    }

    /// The subset of Markdown the acknowledgements use. The document title and table headers are left
    /// out: the window has its own title.
    static func parse(_ markdown: String) -> [Block] {
        var blocks: [Block] = []
        var paragraph: [String] = []
        var licence: [String]?
        var tableHeaderSeen = false
        func flush() {
            if !paragraph.isEmpty { blocks.append(.text(inline(paragraph.joined(separator: " ")))) }
            paragraph = []
        }
        for line in markdown.components(separatedBy: "\n") {
            if line.hasPrefix("```") {
                if let lines = licence {
                    blocks.append(.licence(lines.joined(separator: "\n")))
                    licence = nil
                } else {
                    flush()
                    licence = []
                }
                continue
            }
            if licence != nil { licence?.append(line); continue }
            if line.hasPrefix("|") {
                flush()
                let cells = line.split(separator: "|").map { inline(String($0)) }
                if cells.allSatisfy({ $0.allSatisfy { $0 == "-" || $0 == ":" } }) { continue }
                if !tableHeaderSeen { tableHeaderSeen = true; continue }
                if let first = cells.first { blocks.append(.row(first, Array(cells.dropFirst()))) }
                continue
            }
            tableHeaderSeen = false
            if line.hasPrefix("# ") { flush(); continue }
            if line.hasPrefix("#") {
                flush()
                blocks.append(.heading(inline(String(line.drop { $0 == "#" }))))
            } else if line.hasPrefix("- ") {
                flush()
                blocks.append(.item(inline(String(line.dropFirst(2)))))
            } else if line.trimmingCharacters(in: .whitespaces).isEmpty {
                flush()
            } else {
                paragraph.append(line.trimmingCharacters(in: .whitespaces))
            }
        }
        flush()
        return blocks
    }
}

/// The acknowledgements, in a sheet over the Voka window.
struct AcknowledgementsView: View {
    let blocks: [Acknowledgements.Block]
    let strings: StringTable
    let done: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(strings.acknowledgements).font(.title3.weight(.semibold))
            ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    ForEach(Array(blocks.enumerated()), id: \.offset) { _, block in
                        view(for: block)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(16)
                .textSelection(.enabled)
            }
            .scrollIndicators(.visible)
            .background(Color(nsColor: .textBackgroundColor))
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color(nsColor: .separatorColor)))
            HStack {
                Spacer()
                Button(strings.done, action: done).keyboardShortcut(.defaultAction)
            }
        }
        .padding(20)
        .frame(width: 540, height: 520)
    }

    @ViewBuilder
    private func view(for block: Acknowledgements.Block) -> some View {
        switch block {
        case .heading(let text):
            Text(text).font(.headline).padding(.top, 8)
        case .text(let text):
            Text(text).font(.callout).fixedSize(horizontal: false, vertical: true)
        case .item(let text):
            Text("•  " + text).font(.callout).fixedSize(horizontal: false, vertical: true)
        case .row(let name, let details):
            VStack(alignment: .leading, spacing: 2) {
                Text(name).font(.callout.weight(.medium))
                Text(details.joined(separator: " · ")).font(.subheadline).foregroundStyle(.secondary)
            }
            .fixedSize(horizontal: false, vertical: true)
        case .licence(let text):
            Text(text)
                .font(.system(size: 10.5, design: .monospaced))
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
                .padding(10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color(nsColor: .windowBackgroundColor))
                .clipShape(RoundedRectangle(cornerRadius: 6))
        }
    }
}
