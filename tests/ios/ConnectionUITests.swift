import XCTest
import CoreGraphics

final class ConnectionUITests: XCTestCase {
    func testConnectAndLoadOriginalTiles() throws {
        continueAfterFailure = false
        let app = XCUIApplication(bundleIdentifier: "com.tauronic.kit")
        addUIInterruptionMonitor(withDescription: "局域网权限") { alert in
            for label in ["Allow", "允许", "OK", "好"] where alert.buttons[label].exists {
                alert.buttons[label].tap()
                return true
            }
            return false
        }
        app.launch()
        let connect = app.buttons["连接 Windows 大屏"]
        XCTAssertTrue(connect.waitForExistence(timeout: 40), "未显示连接入口")
        connect.tap()
        let address = app.textFields.firstMatch
        XCTAssertTrue(address.waitForExistence(timeout: 15), "未显示 Windows 地址输入框")
        address.tap()
        address.typeText("127.0.0.1")
        app.buttons["保存连接"].tap()
        let permission = XCUIApplication(bundleIdentifier: "com.apple.springboard").alerts.firstMatch
        if permission.waitForExistence(timeout: 3) {
            for label in ["Allow", "允许", "OK", "好"] where permission.buttons[label].exists {
                permission.buttons[label].tap()
                break
            }
        }
        let status = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "已连接")).firstMatch
        XCTAssertTrue(status.waitForExistence(timeout: 30), "未连接真实 Rust 同步服务")
        app.buttons["返回"].firstMatch.tap()
        XCTAssertTrue(app.links["图1"].waitForExistence(timeout: 60), "连接后未加载 Windows 原图目录")
        capture(app, "已连接并加载三图")
        for number in 1...5 {
            app.links["图\(number)"].tap()
            let back = app.buttons["返回"].firstMatch
            XCTAssertTrue(back.waitForExistence(timeout: 15))
            sleep(2)
            capture(app, "原图\(number)")
            back.tap()
            XCTAssertTrue(app.links["图1"].waitForExistence(timeout: 15))
        }
    }

    private func capture(_ app: XCUIApplication, _ name: String) {
        var screenshot = app.screenshot()
        let deadline = Date().addingTimeInterval(20)
        while !hasImagePixels(screenshot) && Date() < deadline {
            Thread.sleep(forTimeInterval: 0.2)
            screenshot = app.screenshot()
        }
        let attachment = XCTAttachment(screenshot: screenshot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
        XCTAssertTrue(hasImagePixels(screenshot), "已读取瓦片但界面未画出测试原图：\(name)")
    }

    private func hasImagePixels(_ screenshot: XCUIScreenshot) -> Bool {
        guard let image = screenshot.image.cgImage,
              let context = CGContext(data: nil, width: image.width, height: image.height,
                  bitsPerComponent: 8, bytesPerRow: image.width * 4,
                  space: CGColorSpaceCreateDeviceRGB(),
                  bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue),
              let raw = context.data else { return false }
        context.draw(image, in: CGRect(x: 0, y: 0, width: CGFloat(image.width), height: CGFloat(image.height)))
        let pixels = raw.assumingMemoryBound(to: UInt8.self)
        var samples = 0
        var colored = 0
        for y in stride(from: image.height / 6, to: image.height * 5 / 6, by: 8) {
            for x in stride(from: image.width / 20, to: image.width * 19 / 20, by: 8) {
                let offset = (y * image.width + x) * 4
                let channels = [Int(pixels[offset]), Int(pixels[offset + 1]), Int(pixels[offset + 2])]
                samples += 1
                if channels.max()! - channels.min()! > 50 { colored += 1 }
            }
        }
        return samples > 0 && Double(colored) / Double(samples) > 0.01
    }
}
