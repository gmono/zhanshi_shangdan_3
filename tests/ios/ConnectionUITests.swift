import XCTest

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
        XCTAssertTrue(app.buttons["图1"].waitForExistence(timeout: 60), "连接后未加载 Windows 原图目录")
        capture(app, "已连接并加载三图")
        for number in 1...5 {
            app.buttons["图\(number)"].tap()
            let back = app.buttons["返回"].firstMatch
            XCTAssertTrue(back.waitForExistence(timeout: 15))
            sleep(2)
            capture(app, "原图\(number)")
            back.tap()
            XCTAssertTrue(app.buttons["图1"].waitForExistence(timeout: 15))
        }
    }

    private func capture(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
