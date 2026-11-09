import UIKit
import WebKit
import SafariServices

@MainActor
final class PortalController: UIViewController, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
    let state: PortalState
    let webView: WKWebView
    private var observations: [NSKeyValueObservation] = []
    private var downloads: [ObjectIdentifier: URL] = [:]

    init(state: PortalState) {
        self.state = state
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.allowsInlineMediaPlayback = true
        configuration.applicationNameForUserAgent = "OMPWeb-iOS/1.0"
        webView = WKWebView(frame: .zero, configuration: configuration)
        super.init(nibName: nil, bundle: nil)
    }
    required init?(coder: NSCoder) { fatalError("Use init(state:)") }

    override func viewDidLoad() {
        super.viewDidLoad()
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        webView.isOpaque = false
        webView.backgroundColor = UIColor(red: 21/255, green: 18/255, blue: 23/255, alpha: 1)
        webView.scrollView.backgroundColor = webView.backgroundColor
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(webView)
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: view.topAnchor), webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor), webView.trailingAnchor.constraint(equalTo: view.trailingAnchor)
        ])
        observations = [
            webView.observe(\.estimatedProgress, options: [.new]) { [weak self] _, _ in self?.updateState() },
            webView.observe(\.isLoading, options: [.new]) { [weak self] _, _ in self?.updateState() },
            webView.observe(\.canGoBack, options: [.new]) { [weak self] _, _ in self?.updateState() },
            webView.observe(\.canGoForward, options: [.new]) { [weak self] _, _ in self?.updateState() }
        ]
        webView.load(URLRequest(url: PortalPolicy.home))
    }

    nonisolated private func updateState() {
        // KVO may fire while SwiftUI is updating the representable.
        Task { @MainActor [weak self] in
            guard let self else { return }
            state.loading = webView.isLoading
            state.progress = webView.estimatedProgress
            state.canGoBack = webView.canGoBack
            state.canGoForward = webView.canGoForward
        }
    }

    func reloadPortal() {
        state.failure = nil
        if webView.url != nil { webView.reload() }
        else { webView.load(URLRequest(url: PortalPolicy.home)) }
    }

    func signOut() {
        webView.stopLoading()
        webView.configuration.websiteDataStore.removeData(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), modifiedSince: .distantPast) { [weak self] in
            self?.webView.load(URLRequest(url: PortalPolicy.home))
        }
    }

    func sharePage() {
        let url = webView.url.flatMap { PortalPolicy.isPortal($0) ? $0 : nil } ?? PortalPolicy.home
        share(url)
    }

    private func share(_ url: URL, cleanup: URL? = nil) {
        let sheet = UIActivityViewController(activityItems: [url], applicationActivities: nil)
        sheet.popoverPresentationController?.sourceView = view
        sheet.popoverPresentationController?.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.maxY, width: 1, height: 1)
        if let cleanup {
            sheet.completionWithItemsHandler = { _, _, _, _ in try? FileManager.default.removeItem(at: cleanup) }
        }
        presenter.present(sheet, animated: true)
    }

    private var presenter: UIViewController {
        var controller = view.window?.rootViewController ?? self
        while let next = controller.presentedViewController { controller = next }
        return controller
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { decisionHandler(.cancel); return }
        switch PortalPolicy.destination(for: url, isDownload: action.shouldPerformDownload) {
        case .portal:
            decisionHandler(.allow)
        case .download:
            decisionHandler(.download)
        case .browser:
            decisionHandler(.cancel)
            // Do not let an iframe or an unsolicited redirect open another app.
            if action.navigationType == .linkActivated && (action.targetFrame == nil || action.targetFrame?.isMainFrame == true) {
                presenter.present(SFSafariViewController(url: url), animated: true)
            }
        case .blocked:
            decisionHandler(.cancel)
        }
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if action.targetFrame == nil, let url = action.request.url, PortalPolicy.isPortal(url) {
            webView.load(action.request)
        }
        return nil
    }

    func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        guard let url = response.response.url, PortalPolicy.destination(for: url, isDownload: true) == .download else {
            decisionHandler(.cancel); return
        }
        let disposition = (response.response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Disposition") ?? ""
        decisionHandler(!response.canShowMIMEType || disposition.lowercased().hasPrefix("attachment") ? .download : .allow)
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) { state.failure = nil }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { showFailure(error) }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { showFailure(error) }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        state.failure = "iOS closed the page to free memory. Tap Try again to reconnect. Your remote sessions continue on their hosts."
    }
    private func showFailure(_ error: Error) {
        let code = (error as NSError).code
        guard code != NSURLErrorCancelled, code != 102 else { return }
        if [NSURLErrorServerCertificateUntrusted, NSURLErrorSecureConnectionFailed, NSURLErrorServerCertificateHasBadDate].contains(code) {
            state.failure = "The portal’s secure connection could not be verified. Check its HTTPS certificate and try again."
        } else {
            state.failure = "Connect to your home Wi-Fi or VPN, then try again. The portal must be reachable at ompweb.clong.network."
        }
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = UIAlertController(title: "ompweb", message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
        presenter.present(alert, animated: true)
    }
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = UIAlertController(title: "ompweb", message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(false) })
        alert.addAction(UIAlertAction(title: "Continue", style: .default) { _ in completionHandler(true) })
        presenter.present(alert, animated: true)
    }
    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
        let alert = UIAlertController(title: "ompweb", message: prompt, preferredStyle: .alert)
        alert.addTextField { $0.text = defaultText }
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(nil) })
        alert.addAction(UIAlertAction(title: "OK", style: .default) { [weak alert] _ in completionHandler(alert?.textFields?.first?.text) })
        presenter.present(alert, animated: true)
    }

    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType, decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        decisionHandler(origin.protocol == "https" && origin.host == PortalPolicy.home.host && (origin.port == 0 || origin.port == 443) ? .prompt : .deny)
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { download.delegate = self }
    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { download.delegate = self }
    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        do {
            let directory = FileManager.default.temporaryDirectory.appendingPathComponent("OMPWeb-" + UUID().uuidString, isDirectory: true)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let destination = directory.appendingPathComponent(PortalPolicy.safeFilename(suggestedFilename))
            downloads[ObjectIdentifier(download)] = destination
            completionHandler(destination)
        } catch { completionHandler(nil) }
    }
    func download(_ download: WKDownload, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, decisionHandler: @escaping (WKDownload.RedirectPolicy) -> Void) {
        decisionHandler(request.url.map(PortalPolicy.isPortal) == true ? .allow : .cancel)
    }
    func downloadDidFinish(_ download: WKDownload) {
        if let url = downloads.removeValue(forKey: ObjectIdentifier(download)) { share(url, cleanup: url.deletingLastPathComponent()) }
    }
    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        if let url = downloads.removeValue(forKey: ObjectIdentifier(download)) { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        let alert = UIAlertController(title: "Download failed", message: "Check your connection and download the file again.", preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default))
        presenter.present(alert, animated: true)
    }
}
