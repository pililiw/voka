import Cocoa
import VokaCore

public final class CandidateWindowController: NSObject {
    public static let shared = CandidateWindowController()

    private let panel: NSPanel
    private let effectView = NSVisualEffectView()
    private let stackView = NSStackView()
    public var onSelectCandidate: ((Int) -> Void)?
    public var onRestoreCorrection: (() -> Void)?
    private var dismissCorrection: DispatchWorkItem?

    private override init() {
        panel = NSPanel(
            contentRect: NSRect(x: 0, y: 0, width: 320, height: 40),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: true
        )
        super.init()
        panel.level = .popUpMenu
        panel.isFloatingPanel = true
        panel.hidesOnDeactivate = false
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]

        effectView.material = .popover
        effectView.blendingMode = .behindWindow
        effectView.state = .active
        effectView.wantsLayer = true
        effectView.layer?.cornerRadius = 10
        effectView.layer?.masksToBounds = true
        effectView.layer?.borderWidth = 0.5
        effectView.layer?.borderColor = NSColor.separatorColor.cgColor

        stackView.translatesAutoresizingMaskIntoConstraints = false
        stackView.edgeInsets = NSEdgeInsets(top: 6, left: 8, bottom: 6, right: 8)
        stackView.spacing = 6

        effectView.addSubview(stackView)
        NSLayoutConstraint.activate([
            stackView.topAnchor.constraint(equalTo: effectView.topAnchor),
            stackView.bottomAnchor.constraint(equalTo: effectView.bottomAnchor),
            stackView.leadingAnchor.constraint(equalTo: effectView.leadingAnchor),
            stackView.trailingAnchor.constraint(equalTo: effectView.trailingAnchor)
        ])

        panel.contentView = effectView
    }

    public func hide() {
        dismissCorrection?.cancel()
        dismissCorrection = nil
        panel.orderOut(nil)
    }

    public func showCandidates(view: HostView, caretRect: NSRect) {
        dismissCorrection?.cancel()
        let settings = Settings.shared
        guard view.show, !view.candidates.isEmpty,
              Self.hasSomethingToSay(view, showsMeanings: settings.showsMeanings) else {
            hide()
            return
        }

        stackView.arrangedSubviews.forEach { $0.removeFromSuperview() }
        stackView.orientation = .horizontal
        stackView.alignment = .centerY

        for (idx, cand) in view.candidates.enumerated() {
            let isSelected = (idx == view.selected)
            stackView.addArrangedSubview(makeCandidateItemView(
                index: idx,
                number: settings.numberKeysPick ? idx + 1 : nil,
                candidate: cand,
                showsMeaning: settings.showsMeanings,
                isSelected: isSelected,
                confirmWithEnter: isSelected && view.explicitSelection == true,
                isTabTarget: idx == view.tabIndex
            ))
        }

        layoutAndPosition(near: caretRect)
    }

    /// Without meanings, a window whose only candidate is the word as typed tells the user nothing.
    static func hasSomethingToSay(_ view: HostView, showsMeanings: Bool) -> Bool {
        if showsMeanings || view.candidates.count != 1 { return true }
        return view.candidates[0].word != view.preedit || !view.candidates[0].hint.isEmpty
    }

    public func showCorrection(_ correction: HostCorrection, caretRect: NSRect) {
        dismissCorrection?.cancel()
        stackView.arrangedSubviews.forEach { $0.removeFromSuperview() }
        stackView.orientation = .horizontal
        stackView.alignment = .centerY
        let label = NSTextField(labelWithString: Strings.current.corrected(to: correction.replacement.trimmingCharacters(in: .whitespacesAndNewlines)))
        label.font = .systemFont(ofSize: 11.5)
        label.textColor = .secondaryLabelColor
        label.lineBreakMode = .byTruncatingTail
        label.widthAnchor.constraint(lessThanOrEqualToConstant: 230).isActive = true
        let button = NSButton(title: Strings.current.restore(correction.original.trimmingCharacters(in: .whitespacesAndNewlines)),
                              target: self, action: #selector(restoreCorrection))
        button.bezelStyle = .inline
        button.font = .systemFont(ofSize: 11.5)
        stackView.addArrangedSubview(label)
        stackView.addArrangedSubview(button)
        layoutAndPosition(near: caretRect)
        let dismiss = DispatchWorkItem { [weak self] in self?.hide() }
        dismissCorrection = dismiss
        DispatchQueue.main.asyncAfter(deadline: .now() + 4, execute: dismiss)
    }

    @objc private func restoreCorrection() { onRestoreCorrection?() }

    private func makeCandidateItemView(
        index: Int,
        number: Int?,
        candidate: HostCandidate,
        showsMeaning: Bool,
        isSelected: Bool,
        confirmWithEnter: Bool,
        isTabTarget: Bool
    ) -> NSView {
        let container = ClickableRowView { [weak self] in
            self?.onSelectCandidate?(index)
        }
        container.wantsLayer = true
        container.layer?.cornerRadius = 6
        if isSelected {
            container.layer?.backgroundColor = NSColor.controlAccentColor.cgColor
        }

        let row = NSStackView()
        row.translatesAutoresizingMaskIntoConstraints = false
        row.orientation = .horizontal
        row.alignment = .firstBaseline
        row.spacing = 5
        row.edgeInsets = NSEdgeInsets(top: 4, left: 7, bottom: 4, right: 7)

        let wordLabel = NSTextField(labelWithString: candidate.word)
        wordLabel.font = .systemFont(ofSize: 14, weight: .semibold)
        wordLabel.textColor = isSelected ? .white : .labelColor
        wordLabel.lineBreakMode = .byTruncatingTail
        wordLabel.widthAnchor.constraint(lessThanOrEqualToConstant: 220).isActive = true

        if let number = number {
            let numberLabel = NSTextField(labelWithString: String(number))
            numberLabel.font = .monospacedDigitSystemFont(ofSize: 11, weight: .regular)
            numberLabel.textColor = isSelected ? NSColor.white.withAlphaComponent(0.85) : .tertiaryLabelColor
            row.addArrangedSubview(numberLabel)
        }
        row.addArrangedSubview(wordLabel)

        // The highlighted candidate shows its whole gloss, the others their first sense.
        if showsMeaning, !candidate.gloss.isEmpty {
            let shortGloss = isSelected
                ? candidate.gloss
                : String(candidate.gloss.split(separator: "；", maxSplits: 1).first ?? "")
            let glossLabel = NSTextField(labelWithString: shortGloss)
            glossLabel.font = .systemFont(ofSize: 11.5)
            glossLabel.textColor = isSelected ? NSColor.white.withAlphaComponent(0.85) : .secondaryLabelColor
            glossLabel.lineBreakMode = .byTruncatingTail
            glossLabel.widthAnchor.constraint(lessThanOrEqualToConstant: 200).isActive = true
            row.addArrangedSubview(glossLabel)
        }

        if !candidate.hint.isEmpty {
            let badge = NSTextField(labelWithString: candidate.hint)
            badge.font = .systemFont(ofSize: 10, weight: .medium)
            badge.textColor = isSelected ? .white : .systemTeal
            row.addArrangedSubview(badge)
        }
        if isSelected || isTabTarget {
            let keys = [isSelected ? (confirmWithEnter ? "↵" : Strings.current.space) : nil, isTabTarget ? "Tab" : nil].compactMap { $0 }
            let tabHint = NSTextField(labelWithString: keys.joined(separator: " / "))
            tabHint.font = .monospacedSystemFont(ofSize: 10, weight: .medium)
            tabHint.textColor = isSelected ? NSColor.white.withAlphaComponent(0.85) : .secondaryLabelColor
            row.addArrangedSubview(tabHint)
        }

        container.addSubview(row)
        NSLayoutConstraint.activate([
            row.topAnchor.constraint(equalTo: container.topAnchor),
            row.bottomAnchor.constraint(equalTo: container.bottomAnchor),
            row.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            row.trailingAnchor.constraint(equalTo: container.trailingAnchor)
        ])

        return container
    }

    private func layoutAndPosition(near caretRect: NSRect) {
        effectView.layoutSubtreeIfNeeded()
        let fittingSize = stackView.fittingSize
        let screen = NSScreen.screens.first(where: { $0.frame.intersects(caretRect) }) ?? NSScreen.main
        let visible = screen?.visibleFrame
        let width = min(max(140, min(700, fittingSize.width)), max(1, (visible?.width ?? 716) - 16))
        let height = min(max(32, fittingSize.height), max(1, (visible?.height ?? 10000) - 16))

        var originX = caretRect.origin.x
        var originY = caretRect.origin.y - height - 5

        // Clamp within current screen visible frame
        if let visible = visible {
            originX = min(max(originX, visible.minX + 8), visible.maxX - width - 8)
            if originY < visible.minY + 8 {
                originY = caretRect.maxY + 5
            }
            originY = min(max(originY, visible.minY + 8), visible.maxY - height - 8)
        }

        panel.setFrame(NSRect(x: originX, y: originY, width: width, height: height), display: true)
        panel.orderFrontRegardless()
    }
}

private final class ClickableRowView: NSView {
    private let onClick: () -> Void
    init(onClick: @escaping () -> Void) {
        self.onClick = onClick
        super.init(frame: .zero)
    }
    required init?(coder: NSCoder) { nil }
    override func mouseDown(with event: NSEvent) {
        onClick()
    }
}
