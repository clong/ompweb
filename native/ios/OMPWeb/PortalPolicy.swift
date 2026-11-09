import Foundation

enum PortalPolicy {
    static let home = URL(string: "https://ompweb.clong.network")!

    enum Destination: Equatable { case portal, download, browser, blocked }

    static func destination(for url: URL, isDownload: Bool = false) -> Destination {
        // Blob exports inherit their creator's origin. Do not permit arbitrary blob URLs.
        if url.scheme == "blob", isDownload,
           let origin = URL(string: String(url.absoluteString.dropFirst(5))), isPortal(origin) {
            return .download
        }
        if isPortal(url) { return isDownload ? .download : .portal }
        if ["https", "http"].contains(url.scheme?.lowercased() ?? ""),
           url.host != nil, url.user == nil, url.password == nil { return .browser }
        return .blocked
    }

    static func isPortal(_ url: URL) -> Bool {
        url.scheme?.lowercased() == "https" && url.host?.lowercased() == home.host &&
        (url.port == nil || url.port == 443) && url.user == nil && url.password == nil
    }

    static func safeFilename(_ name: String) -> String {
        let leaf = (name.replacingOccurrences(of: "\\", with: "/") as NSString).lastPathComponent
        let cleaned = leaf.components(separatedBy: .controlCharacters).joined()
        return cleaned.isEmpty || cleaned == "." || cleaned == ".." ? "Download" : String(cleaned.prefix(180))
    }
}
