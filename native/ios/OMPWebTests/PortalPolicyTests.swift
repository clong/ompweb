import XCTest
@testable import OMPWeb

final class PortalPolicyTests: XCTestCase {
    func testPushNavigationAcceptsOnlySessionIdentifiers() {
        XCTAssertEqual(PortalPolicy.notificationURL(sessionID: "abc-123")?.absoluteString, "https://ompweb.clong.network?session=abc-123")
        XCTAssertEqual(PortalPolicy.notificationURL(sessionID: ""), PortalPolicy.home)
        XCTAssertNil(PortalPolicy.notificationURL(sessionID: nil))
        for value in ["https://evil.test", "../login", "abc&next=evil", String(repeating: "x", count: 257)] {
            XCTAssertNil(PortalPolicy.notificationURL(sessionID: value))
        }
    }
    func testPortalRequiresExactHTTPSOrigin() {
        for address in ["https://ompweb.clong.network", "https://ompweb.clong.network:443/login?next=%2F", "https://OMPWEB.CLONG.NETWORK/api/sessions"] {
            XCTAssertEqual(PortalPolicy.destination(for: URL(string: address)!), .portal)
        }
        for address in ["http://ompweb.clong.network", "https://ompweb.clong.network.evil.test", "https://ompweb.clong.network:8443", "https://example.com"] {
            XCTAssertEqual(PortalPolicy.destination(for: URL(string: address)!), .browser)
        }
    }
    func testExecutableAndCredentialURLsAreBlocked() {
        for address in ["javascript:alert(1)", "file:///etc/passwd", "data:text/html,hello", "https://user:password@ompweb.clong.network", "tel:5551234"] {
            XCTAssertEqual(PortalPolicy.destination(for: URL(string: address)!), .blocked)
        }
    }
    func testBlobDownloadsRequireThePortalOrigin() {
        XCTAssertEqual(PortalPolicy.destination(for: URL(string: "blob:https://ompweb.clong.network/123")!, isDownload: true), .download)
        XCTAssertEqual(PortalPolicy.destination(for: URL(string: "blob:https://example.com/123")!, isDownload: true), .blocked)
        XCTAssertEqual(PortalPolicy.destination(for: URL(string: "blob:https://ompweb.clong.network/123")!), .blocked)
        XCTAssertEqual(PortalPolicy.destination(for: PortalPolicy.home, isDownload: true), .download)
    }
    func testDownloadFilenamesCannotEscapeTheirDirectory() {
        XCTAssertEqual(PortalPolicy.safeFilename("../../report.txt"), "report.txt")
        XCTAssertEqual(PortalPolicy.safeFilename("..\\..\\report.txt"), "report.txt")
        XCTAssertEqual(PortalPolicy.safeFilename(".."), "Download")
        XCTAssertEqual(PortalPolicy.safeFilename(""), "Download")
        XCTAssertEqual(PortalPolicy.safeFilename("report\n.txt"), "report.txt")
    }
}
