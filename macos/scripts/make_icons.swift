#!/usr/bin/env swift
//
// make_icons.swift — regenerates every Voka icon asset from code.
//
//   swift macos/scripts/make_icons.swift
//
// Outputs (macos/Resources/Icons/):
//   Voka.icns          app icon, 16…512 pt @1x/@2x (built with iconutil from a temp .iconset)
//   AppIcon-1024.png   master render of the app icon
//   MenuIcon.png       menu-bar / input-source template glyph, 22×16 px  (1x)
//   MenuIcon@2x.png    same, 44×32 px (2x)
//   MenuIcon.pdf       same artwork as vector, 22×16 pt
//   preview.png        contact sheet for reviewing all of the above
//
// The mark: five sound-level bars whose positions trace a "V". In the app icon the
// bars brighten from left to right — a faint sound resolving into a definite word.
// Everything is drawn with CoreGraphics paths; no external assets, no dependencies.
//
import AppKit
import CoreGraphics

// MARK: - Basics

let sRGB = CGColorSpace(name: CGColorSpace.sRGB)!

struct RGB {
    var r: Double, g: Double, b: Double
    init(_ hex: UInt32) {
        r = Double((hex >> 16) & 0xff) / 255; g = Double((hex >> 8) & 0xff) / 255; b = Double(hex & 0xff) / 255
    }
    init(r: Double, g: Double, b: Double) { self.r = r; self.g = g; self.b = b }
    func mix(_ o: RGB, _ t: Double) -> RGB { RGB(r: r + (o.r - r) * t, g: g + (o.g - g) * t, b: b + (o.b - b) * t) }
    func cg(_ a: CGFloat = 1) -> CGColor { CGColor(colorSpace: sRGB, components: [CGFloat(r), CGFloat(g), CGFloat(b), a])! }
}
func white(_ a: CGFloat = 1) -> CGColor { RGB(0xffffff).cg(a) }
func black(_ a: CGFloat = 1) -> CGColor { RGB(0x000000).cg(a) }

/// Bitmap context whose user space is y-down and `unitsW × unitsH` large.
func makeContext(_ w: Int, _ h: Int, unitsW: CGFloat? = nil, unitsH: CGFloat? = nil) -> CGContext {
    let c = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0, space: sRGB,
                      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    c.translateBy(x: 0, y: CGFloat(h))
    c.scaleBy(x: CGFloat(w) / (unitsW ?? CGFloat(w)), y: -CGFloat(h) / (unitsH ?? CGFloat(h)))
    return c
}

func writePNG(_ image: CGImage, to url: URL, dpi: CGFloat = 72) {
    let rep = NSBitmapImageRep(cgImage: image)
    rep.size = NSSize(width: CGFloat(image.width) * 72 / dpi, height: CGFloat(image.height) * 72 / dpi)
    try! rep.representation(using: .png, properties: [:])!.write(to: url)
}

/// Draws an image upright inside a y-down context, pixel-exact when `rect` is integral.
func blit(_ c: CGContext, _ image: CGImage, _ rect: CGRect, smooth: Bool = false) {
    c.saveGState()
    c.interpolationQuality = smooth ? .high : .none
    c.translateBy(x: 0, y: rect.minY + rect.maxY); c.scaleBy(x: 1, y: -1)
    c.draw(image, in: rect)
    c.restoreGState()
}

func roundedRect(_ r: CGRect, _ radius: CGFloat) -> CGPath {
    let k = min(radius, min(r.width, r.height) / 2)
    return CGPath(roundedRect: r, cornerWidth: k, cornerHeight: k, transform: nil)
}

/// Apple-style continuous-corner rounded rectangle ("squircle").
func squircle(_ r: CGRect, _ k: CGFloat) -> CGPath {
    let p = CGMutablePath(); let x = r.minX, y = r.minY, w = r.width, h = r.height
    let a: CGFloat = 1.528665, b: CGFloat = 1.08849296, c: CGFloat = 0.86840694, d: CGFloat = 0.63149379
    let e: CGFloat = 0.07491139, f: CGFloat = 0.37282383, g: CGFloat = 0.16905956
    func P(_ px: CGFloat, _ py: CGFloat) -> CGPoint { CGPoint(x: px, y: py) }
    p.move(to: P(x + a*k, y))
    p.addLine(to: P(x+w - a*k, y))
    p.addCurve(to: P(x+w - d*k, y + e*k), control1: P(x+w - b*k, y), control2: P(x+w - c*k, y))
    p.addCurve(to: P(x+w - e*k, y + d*k), control1: P(x+w - f*k, y + g*k), control2: P(x+w - g*k, y + f*k))
    p.addCurve(to: P(x+w, y + a*k), control1: P(x+w, y + c*k), control2: P(x+w, y + b*k))
    p.addLine(to: P(x+w, y+h - a*k))
    p.addCurve(to: P(x+w - e*k, y+h - d*k), control1: P(x+w, y+h - b*k), control2: P(x+w, y+h - c*k))
    p.addCurve(to: P(x+w - d*k, y+h - e*k), control1: P(x+w - g*k, y+h - f*k), control2: P(x+w - f*k, y+h - g*k))
    p.addCurve(to: P(x+w - a*k, y+h), control1: P(x+w - c*k, y+h), control2: P(x+w - b*k, y+h))
    p.addLine(to: P(x + a*k, y+h))
    p.addCurve(to: P(x + d*k, y+h - e*k), control1: P(x + b*k, y+h), control2: P(x + c*k, y+h))
    p.addCurve(to: P(x + e*k, y+h - d*k), control1: P(x + f*k, y+h - g*k), control2: P(x + g*k, y+h - f*k))
    p.addCurve(to: P(x, y+h - a*k), control1: P(x, y+h - c*k), control2: P(x, y+h - b*k))
    p.addLine(to: P(x, y + a*k))
    p.addCurve(to: P(x + e*k, y + d*k), control1: P(x, y + b*k), control2: P(x, y + c*k))
    p.addCurve(to: P(x + d*k, y + e*k), control1: P(x + g*k, y + f*k), control2: P(x + f*k, y + g*k))
    p.addCurve(to: P(x + a*k, y), control1: P(x + c*k, y), control2: P(x + b*k, y))
    p.closeSubpath()
    return p
}

func drawLinear(_ c: CGContext, _ stops: [(CGFloat, CGColor)], from: CGPoint, to: CGPoint) {
    let g = CGGradient(colorsSpace: sRGB, colors: stops.map { $0.1 } as CFArray, locations: stops.map { $0.0 })!
    c.drawLinearGradient(g, start: from, end: to, options: [.drawsBeforeStartLocation, .drawsAfterEndLocation])
}

// MARK: - App icon

enum Brand {
    static let top = RGB(0x7C78FA)       // body gradient, top
    static let bottom = RGB(0x3D2AC6)    // body gradient, bottom
    static let glow = RGB(0xA9B4FF)      // soft light from the upper left
    static let barShadow = RGB(0x1B0F78)
    /// Left → right: a faint sound becoming a definite word.
    static let crescendo: [CGFloat] = [0.55, 0.72, 0.88, 1.0, 1.0]
}

/// Pixel-exact layout of the icon for one output size. Large sizes derive from the 1024
/// master grid (body 824 inset 100, radius 185.4, bars 88 wide / 34 apart); the smallest
/// sizes are drawn on purpose-made grids so every bar edge lands on a pixel boundary.
struct IconSpec {
    var size: Int
    var inset: CGFloat      // transparent margin around the body
    var barW: CGFloat, gap: CGFloat, barLen: CGFloat, step: CGFloat, top: CGFloat
    var capRadius: CGFloat
    var detailed: Bool      // rim light, bar shadow, crescendo

    init(size S: Int) {
        size = S
        switch S {
        case ...16:  // bars fuse into a solid stepped V
            inset = 1; barW = 2; gap = 0; barLen = 5; step = 2; top = 4; capRadius = 0; detailed = false
        case ...32:
            inset = 3; barW = 2; gap = 2; barLen = 7; step = 3; top = 10; capRadius = 1; detailed = false
        case ...64:
            inset = 6; barW = 6; gap = 2; barLen = 16; step = 8; top = 17; capRadius = 3; detailed = false
        default:
            let s = CGFloat(S) / 1024
            inset = (100 * s).rounded()
            barW = 2 * (44 * s).rounded(); gap = (34 * s).rounded()
            barLen = (250 * s).rounded(); step = (124 * s).rounded()
            // the V's visual mass sits high, so its box is centred 14/1024 below the middle
            top = (526 * s - (2 * step + barLen) / 2).rounded()
            capRadius = barW / 2; detailed = true
        }
    }
    var body: CGRect { CGRect(x: inset, y: inset, width: CGFloat(size) - 2 * inset, height: CGFloat(size) - 2 * inset) }
    var bars: [CGRect] {
        let total = 5 * barW + 4 * gap, x0 = (CGFloat(size) - total) / 2
        return (0..<5).map { i in
            CGRect(x: x0 + CGFloat(i) * (barW + gap), y: top + CGFloat(2 - abs(i - 2)) * step, width: barW, height: barLen)
        }
    }
}

/// Body gradient computed per pixel in floating point and dithered to 8 bits, so the
/// large flat areas show no banding. Deterministic (hash noise, no RNG).
func bodyGradient(size S: Int, body: CGRect) -> CGImage {
    var buf = [UInt8](repeating: 255, count: S * S * 4)
    func noise(_ x: Int, _ y: Int, _ ch: Int) -> Double {
        var h = UInt32(truncatingIfNeeded: x &* 374761393 &+ y &* 668265263 &+ ch &* 2147483647)
        h = (h ^ (h >> 13)) &* 1274126177; h ^= h >> 16
        return Double(h & 0xffff) / 65536.0
    }
    let gx = Double(body.minX + body.width * 0.26), gy = Double(body.minY + body.height * 0.04)
    let gr = Double(body.width) * 0.95
    for y in 0..<S {
        let t = min(1, max(0, (Double(y) + 0.5 - Double(body.minY)) / Double(body.height)))
        let base = Brand.top.mix(Brand.bottom, t * t * (3 - 2 * t) * 0.35 + t * 0.65)
        for x in 0..<S {
            let dx = (Double(x) + 0.5 - gx) / gr, dy = (Double(y) + 0.5 - gy) / gr
            let g = max(0, 1 - (dx * dx + dy * dy).squareRoot())
            let col = base.mix(Brand.glow, 0.50 * g * g)
            let i = (y * S + x) * 4
            for (ch, v) in [col.r, col.g, col.b].enumerated() {
                let d = noise(x, y, ch) + noise(x, y, ch + 3) - 1   // triangular, ±1 LSB
                buf[i + ch] = UInt8(min(255, max(0, (v * 255 + d).rounded())))
            }
        }
    }
    let data = CFDataCreate(nil, buf, buf.count)!
    return CGImage(width: S, height: S, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: S * 4, space: sRGB,
                   bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.noneSkipLast.rawValue),
                   provider: CGDataProvider(data: data)!, decode: nil, shouldInterpolate: false, intent: .defaultIntent)!
}

func renderAppIcon(_ S: Int) -> CGImage {
    let spec = IconSpec(size: S), s = CGFloat(S) / 1024
    let c = makeContext(S, S)
    let body = spec.body
    let path = squircle(body, body.width * 185.4 / 824)

    // Body, with the customary soft drop shadow living in the margin.
    c.saveGState()
    c.setShadow(offset: CGSize(width: 0, height: -max(10 * s, 0.5)), blur: max(20 * s, 1), color: black(0.30))
    c.beginTransparencyLayer(auxiliaryInfo: nil)
    c.addPath(path); c.clip()
    blit(c, bodyGradient(size: S, body: body), CGRect(x: 0, y: 0, width: S, height: S))
    if spec.detailed {
        // Rim: a thin light edge along the top that fades out, and a faint shade at the foot.
        c.saveGState()
        c.addPath(path); c.setLineWidth(max(6 * s, 1.6)); c.replacePathWithStrokedPath(); c.clip()
        drawLinear(c, [(0, white(0.42)), (0.28, white(0.08)), (0.7, black(0)), (1, black(0.20))],
                   from: CGPoint(x: body.midX, y: body.minY), to: CGPoint(x: body.midX, y: body.maxY))
        c.restoreGState()
    }
    c.endTransparencyLayer()
    c.restoreGState()

    // The mark.
    let bars = spec.bars
    if spec.detailed {
        c.saveGState()
        c.setShadow(offset: CGSize(width: 0, height: -8 * s), blur: 22 * s, color: Brand.barShadow.cg(0.30))
        c.beginTransparencyLayer(auxiliaryInfo: nil)
        for (i, r) in bars.enumerated() {
            c.addPath(roundedRect(r, spec.capRadius)); c.setFillColor(white(Brand.crescendo[i])); c.fillPath()
        }
        c.endTransparencyLayer()
        c.restoreGState()
    } else {
        c.setFillColor(white())
        for r in bars { c.addPath(roundedRect(r, spec.capRadius)) }
        c.fillPath()
    }
    return c.makeImage()!
}

// MARK: - Menu-bar / input-source glyph (template: black + alpha only)

enum Menu {
    /// Canvas in points. The outline is full-bleed, the size of the system's own input-source badges.
    static let size = CGSize(width: 22, height: 16)
    static let corner: CGFloat = 3.5
    /// The five bars, on whole points: 2 wide, 1 apart, 5 long, stepping 2 — a 14×9 pt V
    /// occupying rows 3…12, the same band the system "A" glyph uses.
    static var bars: [CGRect] {
        (0..<5).map { i in CGRect(x: 4 + CGFloat(i) * 3, y: 3 + CGFloat(2 - abs(i - 2)) * 2, width: 2, height: 5) }
    }
    /// Width of the outline, in points.
    static let stroke: CGFloat = 1
    /// An outlined badge with solid bars, as one even-odd path (works for bitmap and PDF alike): the
    /// outer and inner rounded rectangles leave a ring, and the bars inside the hole are filled again.
    /// A solid badge would be the only filled shape in the input source switcher, where the system's
    /// own sources are bare glyphs.
    static func path(capRadius: CGFloat) -> CGPath {
        let p = CGMutablePath()
        let outer = CGRect(origin: .zero, size: size)
        p.addPath(roundedRect(outer, corner))
        p.addPath(roundedRect(outer.insetBy(dx: stroke, dy: stroke), corner - stroke))
        for r in bars { p.addPath(roundedRect(r, capRadius)) }
        return p
    }
    /// 1x is fitted by hand: bars sit exactly on the pixel grid with square ends (every bar
    /// pixel is fully opaque, every neighbour fully clear) because a round cap on a 2 px bar
    /// would only be blur. 2x and PDF use round caps.
    static func capRadius(scale: Int) -> CGFloat { scale == 1 ? 0 : 1.0 }

    static func render(scale: Int) -> CGImage {
        let c = makeContext(Int(size.width) * scale, Int(size.height) * scale, unitsW: size.width, unitsH: size.height)
        c.addPath(path(capRadius: capRadius(scale: scale))); c.setFillColor(black()); c.fillPath(using: .evenOdd)
        return c.makeImage()!
    }

    /// The PDF is written by hand (one even-odd filled path) rather than through Quartz's PDF
    /// context, which stamps the creation time and a random document ID into the file.
    static func writePDF(to url: URL) {
        func n(_ v: CGFloat) -> String {
            var t = String(format: "%.4f", Double(v))
            while t.hasSuffix("0") { t.removeLast() }
            if t.hasSuffix(".") { t.removeLast() }
            return t == "-0" ? "0" : t
        }
        func pt(_ p: CGPoint) -> String { "\(n(p.x)) \(n(size.height - p.y))" }   // PDF space is y-up
        var ops = ["0 g"]
        path(capRadius: capRadius(scale: 2)).applyWithBlock { e in
            let p = e.pointee.points
            switch e.pointee.type {
            case .moveToPoint: ops.append("\(pt(p[0])) m")
            case .addLineToPoint: ops.append("\(pt(p[0])) l")
            case .addCurveToPoint: ops.append("\(pt(p[0])) \(pt(p[1])) \(pt(p[2])) c")
            case .addQuadCurveToPoint: fatalError("unexpected quad curve")
            case .closeSubpath: ops.append("h")
            @unknown default: break
            }
        }
        ops.append("f*")
        let stream = ops.joined(separator: "\n") + "\n"
        let objects = [
            "<< /Type /Catalog /Pages 2 0 R >>",
            "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 \(n(size.width)) \(n(size.height))] /Resources << >> /Contents 4 0 R >>",
            "<< /Length \(stream.utf8.count) >>\nstream\n\(stream)endstream",
        ]
        var out = "%PDF-1.4\n", offsets: [Int] = []
        for (i, o) in objects.enumerated() { offsets.append(out.utf8.count); out += "\(i + 1) 0 obj\n\(o)\nendobj\n" }
        let xref = out.utf8.count
        out += "xref\n0 \(objects.count + 1)\n0000000000 65535 f \n"
        for o in offsets { out += String(format: "%010d 00000 n \n", o) }
        out += "trailer\n<< /Size \(objects.count + 1) /Root 1 0 R >>\nstartxref\n\(xref)\n%%EOF\n"
        try! Data(out.utf8).write(to: url)
    }
}

// MARK: - Preview sheet

func tinted(_ template: CGImage, _ color: CGColor) -> CGImage {
    let c = makeContext(template.width, template.height)
    let r = CGRect(x: 0, y: 0, width: template.width, height: template.height)
    blit(c, template, r)
    c.setBlendMode(.sourceIn); c.setFillColor(color); c.fill(r)
    return c.makeImage()!
}

func drawText(_ c: CGContext, _ s: String, at p: CGPoint, font: NSFont, color: CGColor, centeredIn width: CGFloat? = nil,
              knockout: Bool = false) {
    let attr = NSAttributedString(string: s, attributes: [.font: font, .foregroundColor: NSColor(cgColor: color)!])
    let g = NSGraphicsContext(cgContext: c, flipped: true)
    NSGraphicsContext.saveGraphicsState(); NSGraphicsContext.current = g
    if knockout { c.setBlendMode(.destinationOut) }
    var origin = p
    if let w = width { origin.x += (w - attr.size().width) / 2 }
    attr.draw(at: origin)
    NSGraphicsContext.restoreGraphicsState()
    c.setBlendMode(.normal)
}

/// Stand-in for a system input-source badge ("A", "拼"), for side-by-side comparison only.
func mockBadge(_ glyph: String, font: NSFont, baseline: CGFloat, scale: Int) -> CGImage {
    let c = makeContext(22 * scale, 16 * scale, unitsW: 22, unitsH: 16)
    c.addPath(roundedRect(CGRect(x: 0, y: 0, width: 22, height: 16), Menu.corner)); c.setFillColor(black()); c.fillPath()
    drawText(c, glyph, at: CGPoint(x: 0, y: baseline - font.ascender), font: font, color: black(), centeredIn: 22, knockout: true)
    return c.makeImage()!
}

func renderPreview(icons: [Int: CGImage], menu: [Int: CGImage]) -> CGImage {
    let panelW = 960, H = 964
    let c = makeContext(panelW * 2, H)
    let label = NSFont.systemFont(ofSize: 13, weight: .medium), title = NSFont.systemFont(ofSize: 17, weight: .semibold)

    for (n, dark) in [false, true].enumerated() {
        let ox = CGFloat(n * panelW)
        let bg = RGB(dark ? 0x1D1E22 : 0xECECEF), ink = dark ? white(0.55) : black(0.50)
        let strong = dark ? white(0.9) : black(0.82)
        c.setFillColor(bg.cg()); c.fill(CGRect(x: ox, y: 0, width: CGFloat(panelW), height: CGFloat(H)))
        func cap(_ s: String, _ x: CGFloat, _ y: CGFloat) { drawText(c, s, at: CGPoint(x: ox + x, y: y), font: label, color: ink) }
        func put(_ img: CGImage, _ x: CGFloat, _ y: CGFloat, zoom: Int = 1) {
            blit(c, img, CGRect(x: ox + x, y: y, width: CGFloat(img.width * zoom), height: CGFloat(img.height * zoom)))
        }
        drawText(c, dark ? "Voka — on dark" : "Voka — on light", at: CGPoint(x: ox + 40, y: 24), font: title, color: strong)

        // App icon, actual pixels.
        put(icons[512]!, 40, 64);  cap("512", 40, 584)
        put(icons[128]!, 592, 64); cap("128", 592, 200)
        put(icons[64]!, 744, 64);  cap("64", 744, 200)
        put(icons[32]!, 832, 64);  cap("32", 832, 200)
        put(icons[16]!, 888, 64);  cap("16", 888, 200)
        // Small sizes enlarged, nearest neighbour.
        put(icons[32]!, 592, 250, zoom: 6); cap("32 px × 6", 592, 450)
        put(icons[16]!, 808, 282, zoom: 8); cap("16 px × 8", 808, 450)

        // Menu-bar strips: [A] [Voka] [拼], built at native pixels, then shown 1:1 and enlarged.
        let barBG = RGB(dark ? 0x2B2C31 : 0xDDDEE3), tint = dark ? white(0.92) : black(0.85)
        for (row, scale) in [1, 2].enumerated() {
            let y0 = CGFloat(640 + row * 150)
            let a = mockBadge("A", font: NSFont.systemFont(ofSize: 11.5, weight: .semibold), baseline: 12.1, scale: scale)
            let pin = mockBadge("拼", font: NSFont(name: "PingFangSC-Semibold", size: 11) ?? NSFont.systemFont(ofSize: 11, weight: .semibold),
                                baseline: 12.0, scale: scale)
            let gapPx = 14 * scale, w = 22 * scale, h = 16 * scale, pad = 10 * scale
            let stripW = pad * 2 + w * 3 + gapPx * 2, stripH = 24 * scale
            let t = makeContext(stripW, stripH)
            t.setFillColor(barBG.cg()); t.fill(CGRect(x: 0, y: 0, width: stripW, height: stripH))
            for (i, img) in [a, menu[scale]!, pin].enumerated() {
                blit(t, tinted(img, tint), CGRect(x: pad + i * (w + gapPx), y: (stripH - h) / 2, width: w, height: h))
            }
            let strip = t.makeImage()!, zoom = 4 / scale
            cap("Menu bar · \(scale)x", 40, y0)
            put(strip, 40, y0 + 28)
            put(strip, 300, y0, zoom: zoom)
            cap("× \(zoom)", 300 + CGFloat(stripW * zoom) + 14, y0)
        }
        cap("Order: A · Voka · 拼.  A and 拼 are mock-ups of the system badges; Voka is the shipped template image.", 40, 920)
    }
    return c.makeImage()!
}

// MARK: - Main

let scriptURL = URL(fileURLWithPath: #filePath)
let outDir = scriptURL.deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("Resources/Icons")
let fm = FileManager.default
try! fm.createDirectory(at: outDir, withIntermediateDirectories: true)

// App icon: every pixel size is rendered natively (not downscaled from the master).
var icons: [Int: CGImage] = [:]
for px in [16, 32, 64, 128, 256, 512, 1024] { icons[px] = renderAppIcon(px) }
writePNG(icons[1024]!, to: outDir.appendingPathComponent("AppIcon-1024.png"))

let iconset = fm.temporaryDirectory.appendingPathComponent("voka-\(ProcessInfo.processInfo.processIdentifier)/Voka.iconset")
try! fm.createDirectory(at: iconset, withIntermediateDirectories: true)
for pt in [16, 32, 128, 256, 512] {
    writePNG(icons[pt]!, to: iconset.appendingPathComponent("icon_\(pt)x\(pt).png"))
    writePNG(icons[pt * 2]!, to: iconset.appendingPathComponent("icon_\(pt)x\(pt)@2x.png"), dpi: 144)
}
let iconutil = Process()
iconutil.executableURL = URL(fileURLWithPath: "/usr/bin/iconutil")
iconutil.arguments = ["-c", "icns", iconset.path, "-o", outDir.appendingPathComponent("Voka.icns").path]
try! iconutil.run(); iconutil.waitUntilExit()
try? fm.removeItem(at: iconset.deletingLastPathComponent())
guard iconutil.terminationStatus == 0 else { fatalError("iconutil failed") }

// Menu glyph.
let menu = [1: Menu.render(scale: 1), 2: Menu.render(scale: 2)]
writePNG(menu[1]!, to: outDir.appendingPathComponent("MenuIcon.png"))
writePNG(menu[2]!, to: outDir.appendingPathComponent("MenuIcon@2x.png"), dpi: 144)
Menu.writePDF(to: outDir.appendingPathComponent("MenuIcon.pdf"))

// Preview.
writePNG(renderPreview(icons: icons, menu: menu), to: outDir.appendingPathComponent("preview.png"))

print("Wrote Voka.icns, AppIcon-1024.png, MenuIcon.png, MenuIcon@2x.png, MenuIcon.pdf, preview.png → \(outDir.path)")
