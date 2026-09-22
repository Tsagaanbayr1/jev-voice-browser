// axbridge — macOS-ийн accessibility tree-г уншиж, түүн дээр JSON хэлбэрээр ажиллана.
//
// Энэ бол computer use-ийн perception + execution хэсэг. Зориуд пиксел рүү
// ХАРДАХГҮЙ: апп бүрийн accessibility API-аас түүний жинхэнэ control-уудыг
// асуудаг ба тэдгээр нь текст (role, title, value) болж буцаж ирдэг. Энэ нь
// зөвхөн текст дээр ажилладаг decision model-д desktop-ийг жолоодох боломж
// олгох бөгөөд үйлдлүүд нь таамагласан coordinate дээрх mouse click биш, semantic
// (товч дээр AXPress) болно — тиймээс cursor хөдлөхгүй, цонхны байрлалаас хамаарахгүй.
//
// Trade-off, бусдын хэмжсэн бөгөөд тодорхой хэлэх ёстой: зөвхөн зарим апп
// бүрэн accessibility tree-г ил гаргадаг. Canvas апп, тоглоом болон олон
// Electron апп маш бага эсвэл юу ч ил гаргахгүй, энэ хэрэгсэл тэднийг жолоодож чадахгүй. docs-ыг үзнэ үү.
//
// Commands (JSON on stdout, always; errors as {"error": "..."} with exit 1):
//   axbridge check                      is accessibility permission granted?
//   axbridge apps                       running apps with a UI
//   axbridge snapshot [--pid N] [--max N] [--all-windows]
//   axbridge act --pid N --ref REF --action press|setvalue|focus [--value TEXT]
//
// REF бол "w0.3.1.4" гэх мэт тунгалаг зам: цонхны индекс, дараа нь хүүхдийн индексүүд.
// Энэ нь act бүрт шинээр resolve хийгддэг тул хуучирсан ref тэр байрлал руу
// шилжсэн зүйл дээр дарахын оронд чангаар унана.

import AppKit
import ApplicationServices
import Foundation

// MARK: - output

func emit(_ obj: Any) -> Never {
    let data = try! JSONSerialization.data(withJSONObject: obj, options: [.prettyPrinted, .sortedKeys])
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write("\n".data(using: .utf8)!)
    exit(0)
}

func fail(_ message: String) -> Never {
    let data = try! JSONSerialization.data(withJSONObject: ["error": message])
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write("\n".data(using: .utf8)!)
    exit(1)
}

// MARK: - accessibility helpers

func attr(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
    var value: CFTypeRef?
    return AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success ? value : nil
}

func stringAttr(_ element: AXUIElement, _ name: String) -> String? {
    guard let value = attr(element, name) else { return nil }
    if let s = value as? String { return s.isEmpty ? nil : s }
    if let n = value as? NSNumber { return n.stringValue }
    return nil
}

func boolAttr(_ element: AXUIElement, _ name: String) -> Bool? {
    (attr(element, name) as? NSNumber)?.boolValue
}

func children(_ element: AXUIElement) -> [AXUIElement] {
    (attr(element, kAXChildrenAttribute as String) as? [AXUIElement]) ?? []
}

func actionNames(_ element: AXUIElement) -> [String] {
    var names: CFArray?
    guard AXUIElementCopyActionNames(element, &names) == .success else { return [] }
    return (names as? [String]) ?? []
}

func frame(_ element: AXUIElement) -> (x: Double, y: Double, w: Double, h: Double)? {
    guard let posValue = attr(element, kAXPositionAttribute as String),
          let sizeValue = attr(element, kAXSizeAttribute as String) else { return nil }
    var point = CGPoint.zero
    var size = CGSize.zero
    AXValueGetValue(posValue as! AXValue, .cgPoint, &point)
    AXValueGetValue(sizeValue as! AXValue, .cgSize, &size)
    return (point.x, point.y, size.width, size.height)
}

/// Сонголт болгон санал болгох үнэ цэнэтэй role-ууд. Бусад бүхэн нь бүтэц, control биш.
let INTERACTIVE: Set<String> = [
    "AXButton", "AXRadioButton", "AXCheckBox", "AXPopUpButton", "AXMenuButton",
    "AXTextField", "AXTextArea", "AXSearchField", "AXComboBox", "AXSlider",
    "AXLink", "AXMenuItem", "AXTab", "AXRow", "AXCell", "AXDisclosureTriangle",
    "AXIncrementor", "AXStepper", "AXSegmentedControl", "AXToolbarButton",
]

/// Элементийг хүнд таниулах текст, ашигтай байдлын дарааллаар.
func label(_ element: AXUIElement) -> String? {
    stringAttr(element, kAXTitleAttribute as String)
        ?? stringAttr(element, kAXDescriptionAttribute as String)
        ?? stringAttr(element, "AXLabel")
        ?? stringAttr(element, kAXValueAttribute as String)
        ?? stringAttr(element, kAXPlaceholderValueAttribute as String)
        ?? stringAttr(element, kAXHelpAttribute as String)
}

func truncated(_ s: String, _ n: Int) -> String {
    let flat = s.replacingOccurrences(of: "\n", with: " ").trimmingCharacters(in: .whitespacesAndNewlines)
    return flat.count <= n ? flat : String(flat.prefix(n)) + "…"
}

// MARK: - snapshot

struct Found {
    let ref: String
    let role: String
    let label: String
    let value: String?
    let enabled: Bool
    let actions: [String]
    let frame: (x: Double, y: Double, w: Double, h: Double)?
}

/// Хамгийн тод control-ууд эхэндээ гарахын тулд breadth-first, хатуу хязгаартай:
/// Slack-ийн нэг цонхонд хэдэн арван мянган node байж болох бөгөөд зорилго нь
/// decision model-д баримт бичиг биш, богино жагсаалт өгөх юм.
func walk(window: AXUIElement, windowIndex: Int, max: Int) -> [Found] {
    var out: [Found] = []
    var queue: [(AXUIElement, String, Int)] = [(window, "w\(windowIndex)", 0)]
    var visited = 0

    while !queue.isEmpty && out.count < max && visited < 6000 {
        let (element, ref, depth) = queue.removeFirst()
        visited += 1
        if depth > 18 { continue }

        let role = stringAttr(element, kAXRoleAttribute as String) ?? "AXUnknown"
        let acts = actionNames(element)
        let isInteractive = INTERACTIVE.contains(role) || acts.contains(kAXPressAction as String)

        if isInteractive, let text = label(element) {
            let f = frame(element)
            // Тэг хэмжээтэй ба дэлгэцээс гадуур элементүүдийг алгасна: тэдгээр нь
            // жинхэнэ AX node боловч хүн дарж чадах зүйл биш.
            let visible = f == nil || (f!.w > 1 && f!.h > 1)
            if visible {
                out.append(Found(
                    ref: ref,
                    role: role,
                    label: truncated(text, 80),
                    value: stringAttr(element, kAXValueAttribute as String).map { truncated($0, 60) },
                    enabled: boolAttr(element, kAXEnabledAttribute as String) ?? true,
                    actions: acts,
                    frame: f
                ))
            }
        }

        for (i, child) in children(element).enumerated() {
            queue.append((child, "\(ref).\(i)", depth + 1))
        }
    }
    return out
}

func resolve(pid: pid_t, ref: String) -> AXUIElement? {
    let parts = ref.split(separator: ".")
    guard let head = parts.first, head.hasPrefix("w"),
          let windowIndex = Int(head.dropFirst()) else { return nil }
    let app = AXUIElementCreateApplication(pid)
    guard let windows = attr(app, kAXWindowsAttribute as String) as? [AXUIElement],
          windowIndex < windows.count else { return nil }

    var element = windows[windowIndex]
    for part in parts.dropFirst() {
        guard let index = Int(part) else { return nil }
        let kids = children(element)
        guard index < kids.count else { return nil }
        element = kids[index]
    }
    return element
}

// MARK: - commands

func argValue(_ name: String) -> String? {
    let args = CommandLine.arguments
    guard let i = args.firstIndex(of: name), i + 1 < args.count else { return nil }
    return args[i + 1]
}

let hasFlag: (String) -> Bool = { CommandLine.arguments.contains($0) }
let command = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "check"

// Зөвшөөрөл нь Системийн тохиргоо дахь хэрэглэгчийн үйлдэл; кодоор олгож болохгүй.
let trusted = AXIsProcessTrusted()

switch command {
case "check":
    emit([
        "trusted": trusted,
        "hint": trusted
            ? "хандалтын зөвшөөрөл олгогдсон"
            : "Системийн тохиргоо → Нууцлал ба аюулгүй байдал → Хандалт хэсэгт энэ програмыг зөвшөөрөөд дахин оролдоно уу",
    ])

case "apps":
    guard trusted else { fail("хандалтын зөвшөөрөл олгогдоогүй") }
    let apps = NSWorkspace.shared.runningApplications
        .filter { $0.activationPolicy == .regular }
        .map { app -> [String: Any] in
            [
                "pid": app.processIdentifier,
                "name": app.localizedName ?? "?",
                "bundleId": app.bundleIdentifier ?? "",
                "frontmost": app.isActive,
            ]
        }
    emit(["apps": apps])

case "snapshot":
    guard trusted else { fail("хандалтын зөвшөөрөл олгогдоогүй") }
    let max = Int(argValue("--max") ?? "") ?? 80
    var pid: pid_t
    if let p = argValue("--pid"), let n = Int32(p) {
        pid = n
    } else {
        guard let front = NSWorkspace.shared.frontmostApplication else { fail("no frontmost application") }
        pid = front.processIdentifier
    }
    guard let app = NSRunningApplication(processIdentifier: pid) else { fail("no application with pid \(pid)") }

    let axApp = AXUIElementCreateApplication(pid)
    let allWindows = (attr(axApp, kAXWindowsAttribute as String) as? [AXUIElement]) ?? []
    guard !allWindows.isEmpty else {
        emit([
            "app": app.localizedName ?? "?", "bundleId": app.bundleIdentifier ?? "", "pid": pid,
            "windows": [], "elements": [],
            "note": "no accessible windows: this app exposes no accessibility tree, or has no open window",
        ])
    }

    // Анхдагчаар зөвхөн фокустай цонх; бүх аппын snapshot хурдан томордог.
    let indices = hasFlag("--all-windows") ? Array(allWindows.indices) : [0]
    var elements: [[String: Any]] = []
    for i in indices {
        for f in walk(window: allWindows[i], windowIndex: i, max: max - elements.count) {
            var row: [String: Any] = [
                "ref": f.ref, "role": f.role, "label": f.label,
                "enabled": f.enabled, "actions": f.actions,
            ]
            if let v = f.value, v != f.label { row["value"] = v }
            if let fr = f.frame { row["rect"] = [Int(fr.x), Int(fr.y), Int(fr.w), Int(fr.h)] }
            elements.append(row)
        }
    }

    let windowTitles = allWindows.map { stringAttr($0, kAXTitleAttribute as String) ?? "" }
    emit([
        "app": app.localizedName ?? "?",
        "bundleId": app.bundleIdentifier ?? "",
        "pid": pid,
        "windows": windowTitles,
        "elements": elements,
        "truncated": elements.count >= max,
    ])

case "act":
    guard trusted else { fail("хандалтын зөвшөөрөл олгогдоогүй") }
    guard let pidText = argValue("--pid"), let pid = Int32(pidText) else { fail("--pid is required") }
    guard let ref = argValue("--ref") else { fail("--ref is required") }
    let action = argValue("--action") ?? "press"
    guard let element = resolve(pid: pid, ref: ref) else {
        fail("ref \(ref) no longer resolves — the window changed; take a fresh snapshot")
    }

    switch action {
    case "press":
        let available = actionNames(element)
        let chosen = available.contains(kAXPressAction as String) ? (kAXPressAction as String) : available.first
        guard let name = chosen else { fail("element has no actions") }
        let err = AXUIElementPerformAction(element, name as CFString)
        guard err == .success else { fail("AXPerformAction(\(name)) failed: \(err.rawValue)") }
        emit(["ok": true, "action": name, "ref": ref])

    case "setvalue":
        guard let value = argValue("--value") else { fail("--value is required for setvalue") }
        // Эхлээд focus хийнэ: зарим талбар фокусгүй үед тавьсан утгыг үл тоодог.
        AXUIElementSetAttributeValue(element, kAXFocusedAttribute as CFString, kCFBooleanTrue)
        let err = AXUIElementSetAttributeValue(element, kAXValueAttribute as CFString, value as CFTypeRef)
        guard err == .success else { fail("AXSetValue failed: \(err.rawValue)") }
        emit(["ok": true, "action": "setvalue", "ref": ref, "value": value])

    case "focus":
        let err = AXUIElementSetAttributeValue(element, kAXFocusedAttribute as CFString, kCFBooleanTrue)
        guard err == .success else { fail("AXSetFocused failed: \(err.rawValue)") }
        emit(["ok": true, "action": "focus", "ref": ref])

    default:
        fail("unknown action \(action)")
    }

default:
    fail("unknown command \(command); try check | apps | snapshot | act")
}
