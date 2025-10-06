import AppKit

struct RectData: Codable {
    let x: Double
    let y: Double
    let width: Double
    let height: Double

    init(_ rect: NSRect) {
        self.x = Double(rect.origin.x)
        self.y = Double(rect.origin.y)
        self.width = Double(rect.size.width)
        self.height = Double(rect.size.height)
    }
}

struct EdgeInsetsData: Codable {
    let top: Double
    let left: Double
    let bottom: Double
    let right: Double

    init(_ insets: NSEdgeInsets) {
        self.top = Double(insets.top)
        self.left = Double(insets.left)
        self.bottom = Double(insets.bottom)
        self.right = Double(insets.right)
    }
}

struct ScreenNotchInfo: Codable {
    let id: UInt32
    let isBuiltIn: Bool
    let hasNotch: Bool
    let notchWidth: Double
    let notchCenterX: Double
    let menuBarHeight: Double
    let frame: RectData
    let visibleFrame: RectData
    let safeAreaInsets: EdgeInsetsData
    let auxiliaryLeft: RectData?
    let auxiliaryRight: RectData?
    let scaleFactor: Double
}

struct NotchReport: Codable {
    let timestamp: Double
    let screens: [ScreenNotchInfo]
}

@main
struct NotchReporter {
    static func main() {
        guard ProcessInfo.processInfo.environment["TERM_PROGRAM"] != "ScriptEditor" else {
            print("{\"error\":\"unsupported-environment\"}")
            return
        }

        let timestamp = Date().timeIntervalSince1970
        let screens = NSScreen.screens

        let screenInfos: [ScreenNotchInfo] = screens.compactMap { screen -> ScreenNotchInfo? in
            guard let number = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber else {
                return nil
            }
            let displayId = CGDirectDisplayID(number.uint32Value)
            let isBuiltin = CGDisplayIsBuiltin(displayId) != 0

            let frame = screen.frame
            let visibleFrame = screen.visibleFrame
            let menuBarHeight = Double(frame.maxY - visibleFrame.maxY)

            var leftRect: RectData? = nil
            var rightRect: RectData? = nil
            var notchWidth = 0.0
            var notchCenterX = Double(frame.midX)

            if #available(macOS 12.0, *) {
                if let left = screen.auxiliaryTopLeftArea,
                   let right = screen.auxiliaryTopRightArea,
                   !left.isEmpty,
                   !right.isEmpty {
                    notchWidth = Double(frame.width - left.width - right.width)
                    leftRect = RectData(left)
                    rightRect = RectData(right)
                    notchCenterX = Double(left.maxX + notchWidth / 2.0)
                }
            }

            let safeInsets: EdgeInsetsData
            if #available(macOS 12.0, *) {
                safeInsets = EdgeInsetsData(screen.safeAreaInsets)
            } else {
                safeInsets = EdgeInsetsData(NSEdgeInsetsZero)
            }

            return ScreenNotchInfo(
                id: displayId,
                isBuiltIn: isBuiltin,
                hasNotch: notchWidth > 0.0,
                notchWidth: notchWidth,
                notchCenterX: notchWidth > 0.0 ? notchCenterX : Double(frame.midX),
                menuBarHeight: menuBarHeight,
                frame: RectData(frame),
                visibleFrame: RectData(visibleFrame),
                safeAreaInsets: safeInsets,
                auxiliaryLeft: leftRect,
                auxiliaryRight: rightRect,
                scaleFactor: Double(screen.backingScaleFactor)
            )
        }

        let report = NotchReport(timestamp: timestamp, screens: screenInfos)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted]

        do {
            let data = try encoder.encode(report)
            if let json = String(data: data, encoding: .utf8) {
                print(json)
            } else {
                print("{\"error\":\"encoding-failed\"}")
            }
        } catch {
            print("{\"error\":\"\(error.localizedDescription)\"}")
        }
    }
}
