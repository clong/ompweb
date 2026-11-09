import SwiftUI
import WebKit

enum Palette {
    static let canvas = Color(red: 21/255, green: 18/255, blue: 23/255)
    static let panel = Color(red: 17/255, green: 14/255, blue: 18/255)
    static let teal = Color(red: 112/255, green: 185/255, blue: 190/255)
    static let plum = Color(red: 196/255, green: 140/255, blue: 185/255)
}

@MainActor
final class PortalState: ObservableObject {
    @Published var loading = true
    @Published var progress = 0.0
    @Published var canGoBack = false
    @Published var canGoForward = false
    @Published var failure: String?
    weak var controller: PortalController?

    func reload() { controller?.reloadPortal() }
    func signOut() async -> Bool { await controller?.signOut() ?? false }
}

struct PortalScreen: View {
    @StateObject private var push = PushNotifications.shared
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var state = PortalState()
    @State private var settings = false
    @State private var confirmSignOut = false

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                Image(systemName: "terminal.fill").foregroundStyle(Palette.teal)
                VStack(alignment: .leading, spacing: 2) {
                    Text("ompweb").font(.headline)
                    Text("ompweb.clong.network").font(.caption2).foregroundStyle(.secondary)
                }
                Spacer()
                Button { settings = true } label: { Image(systemName: "ellipsis.circle").font(.title3) }
                    .accessibilityLabel("App settings").frame(width: 44, height: 44)
            }
            .padding(.horizontal, 16).padding(.vertical, 2).background(Palette.panel)

            ProgressView(value: state.progress)
                .tint(Palette.teal).frame(height: 2).opacity(state.loading ? 1 : 0)

            ZStack {
                PortalView(state: state)
                if let failure = state.failure {
                    VStack(spacing: 16) {
                        Image(systemName: "network.slash").font(.system(size: 38)).foregroundStyle(Palette.plum)
                        Text("Couldn’t open ompweb").font(.title2.bold())
                        Text(failure).font(.callout).foregroundStyle(.secondary).multilineTextAlignment(.center)
                        Button("Try again") { state.reload() }.buttonStyle(.borderedProminent)
                    }.padding(32).frame(maxWidth: .infinity, maxHeight: .infinity).background(Palette.canvas)
                }
            }

            HStack {
                Button { state.controller?.webView.goBack() } label: { Image(systemName: "chevron.left") }
                    .accessibilityLabel("Back").disabled(!state.canGoBack)
                Spacer()
                Button { state.controller?.webView.goForward() } label: { Image(systemName: "chevron.right") }
                    .accessibilityLabel("Forward").disabled(!state.canGoForward)
                Spacer()
                Button { state.reload() } label: { Image(systemName: "arrow.clockwise") }
                    .accessibilityLabel("Reload portal")
                Spacer()
                Button { state.controller?.sharePage() } label: { Image(systemName: "square.and.arrow.up") }
                    .accessibilityLabel("Share page")
            }
            .buttonStyle(ToolbarButtonStyle())
            .padding(.horizontal, 24).frame(height: 44).background(Palette.panel)
        }
        .background(Palette.canvas.ignoresSafeArea()).tint(Palette.teal)
        .onChange(of: scenePhase) { _, phase in if phase == .active { push.scheduleSync() } }
        .sheet(isPresented: $settings) {
            NavigationStack {
                Form {
                    Section("Portal") {
                        LabeledContent("Server", value: "ompweb.clong.network")
                        Button("Open in Safari", systemImage: "safari") {
                            UIApplication.shared.open(PortalPolicy.home)
                        }
                    }
                    Section("On this iPhone") {
                        Text("Sign in with your existing portal password. Your sign-in is saved in this app’s private website storage.")
                        Button("Sign out on this device", role: .destructive) { confirmSignOut = true }
                    }
                    Section("Connection and alerts") {
                        Text("Connect to your home network or a VPN that can reach your home network.")
                    }
                    Section("Notifications") {
                        Text(push.status).font(.callout).foregroundStyle(.secondary)
                        if push.enabled {
                            Button("Retry registration") { Task { await push.enable() } }.disabled(push.busy)
                            Button("Send test notification") { Task { await push.test() } }.disabled(push.busy)
                            Button("Disable notifications", role: .destructive) { Task { _ = await push.disable() } }.disabled(push.busy)
                        } else {
                            Button("Enable notifications") { Task { await push.enable() } }.disabled(push.busy)
                        }
                        Button("Notification settings in iOS") {
                            if let url = URL(string: UIApplication.openNotificationSettingsURLString) { UIApplication.shared.open(url) }
                        }
                    }
                    Section { Text("ompweb for iOS · 1.1").foregroundStyle(.secondary) }
                }
                .navigationTitle("App settings").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { settings = false } } }
                .confirmationDialog("Sign out of ompweb on this device?", isPresented: $confirmSignOut, titleVisibility: .visible) {
                    Button("Sign out", role: .destructive) { Task { if await state.signOut() { settings = false } } }
                } message: { Text("This clears the app’s saved sign-in and local portal preferences.") }
            }.tint(Palette.teal)
        }
    }
}

private struct ToolbarButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.frame(width: 44, height: 44).contentShape(Rectangle())
            .opacity(configuration.isPressed ? 0.5 : 1)
    }
}

struct PortalView: UIViewControllerRepresentable {
    let state: PortalState
    func makeUIViewController(context: Context) -> PortalController {
        let controller = PortalController(state: state)
        state.controller = controller
        return controller
    }
    func updateUIViewController(_ controller: PortalController, context: Context) {}
}
