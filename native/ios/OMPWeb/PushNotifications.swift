import Foundation
import UIKit
import UserNotifications
import WebKit

final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions options: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = PushNotifications.shared
        if PushNotifications.shared.enabled { application.registerForRemoteNotifications() }
        return true
    }
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        PushNotifications.shared.receivedToken(deviceToken.map { String(format: "%02x", $0) }.joined())
    }
    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        PushNotifications.shared.status = "Apple could not register this device for push. Check your connection and retry."
    }
}

private final class NoRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}

@MainActor
final class PushNotifications: NSObject, ObservableObject, UNUserNotificationCenterDelegate {
    static let shared = PushNotifications()
    @Published private(set) var enabled = UserDefaults.standard.bool(forKey: "pushEnabled")
    @Published var status = "Enable alerts for completed sessions, requests for input, and errors."
    @Published private(set) var busy = false
    weak var portal: PortalController?
    private var token: String?
    private var syncTask: Task<Void, Never>?
    private var pendingSession: URL?
    private let redirects = NoRedirects()
    private lazy var session = URLSession(configuration: .ephemeral, delegate: redirects, delegateQueue: nil)
    private let deviceID: String = {
        if let id = UserDefaults.standard.string(forKey: "pushDeviceID") { return id }
        let id = UUID().uuidString
        UserDefaults.standard.set(id, forKey: "pushDeviceID")
        return id
    }()

    func enable() async {
        busy = true
        defer { busy = false }
        do {
            let allowed = try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])
            guard allowed else { status = "Notifications are off in iOS. Enable them in Settings → Notifications → ompweb."; return }
            enabled = true
            UserDefaults.standard.set(true, forKey: "pushEnabled")
            status = "Registering with Apple…"
            UIApplication.shared.registerForRemoteNotifications()
            if token != nil { scheduleSync() }
        } catch { status = "Could not request notification permission. Try again." }
    }

    func receivedToken(_ value: String) { token = value; scheduleSync() }

    func scheduleSync() {
        guard enabled, token != nil, syncTask == nil else { return }
        syncTask = Task { [weak self] in
            guard let self else { return }
            defer { syncTask = nil }
            do {
                try await request("PUT", extra: ["token": token!, "environment": Bundle.main.object(forInfoDictionaryKey: "APNSEnvironment") as? String ?? "production"])
                status = "Notifications enabled on this iPhone."
            } catch { status = error.localizedDescription }
        }
    }

    /// Wait for an in-flight registration before removing it, so opt-out cannot race a PUT.
    func disable() async -> Bool {
        busy = true
        let wasEnabled = enabled
        enabled = false
        await syncTask?.value
        defer { busy = false }
        do {
            try await request("DELETE")
            UserDefaults.standard.set(false, forKey: "pushEnabled")
            UIApplication.shared.unregisterForRemoteNotifications()
            UNUserNotificationCenter.current().removeAllDeliveredNotifications()
            status = "Notifications disabled on this iPhone."
            return true
        } catch {
            enabled = wasEnabled
            status = "Could not remove this device’s push registration. Connect to the portal and try again before signing out."
            return false
        }
    }

    func test() async {
        busy = true
        defer { busy = false }
        await syncTask?.value
        do { try await request("POST"); status = "Test accepted by Apple. Check your notifications." }
        catch { status = error.localizedDescription }
    }

    private func request(_ method: String, extra: [String: String] = [:]) async throws {
        let cookies = await WKWebsiteDataStore.default().httpCookieStore.allCookies()
        guard let cookie = cookies.first(where: { $0.name == "omp_web_session" && $0.isSecure && $0.domain.trimmingCharacters(in: CharacterSet(charactersIn: ".")) == PortalPolicy.home.host }) else {
            throw PushError.message("Sign in to the portal, then enable notifications again.")
        }
        var request = URLRequest(url: PortalPolicy.home.appendingPathComponent("api/notifications/ios"))
        request.httpMethod = method
        request.timeoutInterval = 15
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(PortalPolicy.home.absoluteString, forHTTPHeaderField: "Origin")
        request.setValue(HTTPCookie.requestHeaderFields(with: [cookie])["Cookie"], forHTTPHeaderField: "Cookie")
        request.httpBody = try JSONSerialization.data(withJSONObject: extra.merging(["deviceId": deviceID]) { _, new in new })
        let (data, response) = try await session.data(for: request)
        guard let response = response as? HTTPURLResponse else { throw PushError.message("The portal did not respond.") }
        guard (200..<300).contains(response.statusCode) else {
            if response.statusCode == 401 { throw PushError.message("Sign in to the portal again to register notifications.") }
            let error = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
            throw PushError.message(error?["error"] as? String ?? "The portal could not update notifications. Try again.")
        }
    }

    func attach(_ controller: PortalController) -> URL? {
        portal = controller
        defer { pendingSession = nil }
        return pendingSession
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {
        let id = response.notification.request.content.userInfo["sessionId"] as? String
        Task { @MainActor in
            if let url = PortalPolicy.notificationURL(sessionID: id) {
                if let portal { portal.webView.load(URLRequest(url: url)) } else { pendingSession = url }
            }
            completionHandler()
        }
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        let id = notification.request.content.userInfo["sessionId"] as? String
        Task { @MainActor in
            let current = portal?.webView.url.flatMap { URLComponents(url: $0, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "session" })?.value }
            completionHandler(id != nil && id != "" && id == current ? [] : [.banner, .sound])
        }
    }
}

private enum PushError: LocalizedError {
    case message(String)
    var errorDescription: String? { switch self { case .message(let message): return message } }
}
