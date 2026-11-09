import SwiftUI

@main
struct OMPWebApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    var body: some Scene {
        WindowGroup { PortalScreen().preferredColorScheme(.dark) }
    }
}
