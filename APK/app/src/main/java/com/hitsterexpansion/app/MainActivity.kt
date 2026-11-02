package com.hitsterexpansion.app

import android.Manifest
import android.content.pm.PackageManager
import android.content.Intent
import android.app.AlertDialog
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.util.Log
import android.view.View
import android.webkit.ConsoleMessage
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.ComponentActivity
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.webkit.WebViewAssetLoader
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

class MainActivity : ComponentActivity() {
    private var pendingCameraRequest: PermissionRequest? = null
    private lateinit var gameWebView: WebView
    private lateinit var previewWebView: WebView
    private var previewReady = false
    private var pendingPreviewTrackId: String? = null
    private val updateExecutor = Executors.newSingleThreadExecutor()

    private val requestCameraPermission = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        pendingCameraRequest?.let { request ->
            if (granted) request.grant(arrayOf(PermissionRequest.RESOURCE_VIDEO_CAPTURE)) else request.deny()
        }
        pendingCameraRequest = null
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        gameWebView = createWebView(assetLoader).apply {
            addJavascriptInterface(GamePreviewBridge(), "HitsterAndroidPreview")
            addJavascriptInterface(UpdateBridge(), "HitsterUpdates")
            webChromeClient = object : WebChromeClient() {
                override fun onConsoleMessage(consoleMessage: ConsoleMessage): Boolean {
                    if (consoleMessage.message().startsWith("[orientation]")) {
                        Log.i("HitsterOrientation", consoleMessage.message())
                        return true
                    }
                    return super.onConsoleMessage(consoleMessage)
                }

                override fun onPermissionRequest(request: PermissionRequest) {
                    runOnUiThread {
                        if (!request.resources.contains(PermissionRequest.RESOURCE_VIDEO_CAPTURE)) {
                            request.deny()
                        } else if (ContextCompat.checkSelfPermission(
                                this@MainActivity,
                                Manifest.permission.CAMERA
                            ) == PackageManager.PERMISSION_GRANTED) {
                            request.grant(arrayOf(PermissionRequest.RESOURCE_VIDEO_CAPTURE))
                        } else {
                            pendingCameraRequest?.deny()
                            pendingCameraRequest = request
                            requestCameraPermission.launch(Manifest.permission.CAMERA)
                        }
                    }
                }
            }
            loadUrl("https://appassets.androidplatform.net/assets/index.html")
        }

        previewWebView = createWebView(assetLoader).apply {
            addJavascriptInterface(PreviewEventBridge(), "HitsterPreview")
            webViewClient = object : WebViewClient() {
                override fun onPageFinished(view: WebView, url: String) {
                    previewReady = true
                    pendingPreviewTrackId?.let(::playPreview)
                }

                override fun shouldInterceptRequest(
                    view: WebView,
                    request: WebResourceRequest
                ): WebResourceResponse? = assetLoader.shouldInterceptRequest(request.url)
            }
            alpha = 0.01f
            loadUrl("https://appassets.androidplatform.net/assets/spotify-preview.html")
        }

        setContentView(FrameLayout(this).apply {
            addView(gameWebView, FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            ))
            addView(previewWebView, FrameLayout.LayoutParams(1, 1))
        })

        gameWebView.post { checkForUpdate(automatic = true) }
    }

    private fun createWebView(assetLoader: WebViewAssetLoader) = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(
                    view: WebView,
                    request: WebResourceRequest
                ): WebResourceResponse? = assetLoader.shouldInterceptRequest(request.url)
            }
    }

    private fun playPreview(trackId: String) {
        pendingPreviewTrackId = trackId
        if (previewReady) {
            previewWebView.evaluateJavascript(
                "window.playSpotifyPreview(${JSONObject.quote(trackId)});",
                null
            )
        }
    }

    private fun stopPreview() {
        pendingPreviewTrackId = null
        if (previewReady) previewWebView.evaluateJavascript("window.stopSpotifyPreview();", null)
    }

    private fun notifyGame(callback: String, trackId: String) {
        gameWebView.evaluateJavascript(
            "window.HitsterAndroidPreviewCallbacks?.$callback(${JSONObject.quote(trackId)});",
            null
        )
    }

    private fun notifyUpdate(status: String, message: String) {
        gameWebView.post {
            gameWebView.evaluateJavascript(
                "window.HitsterUpdateCallbacks?.onResult(${JSONObject.quote(status)}, ${JSONObject.quote(message)});",
                null
            )
        }
    }

    private fun checkForUpdate(automatic: Boolean = false) {
        updateExecutor.execute {
            try {
                val connection = URL("https://api.github.com/repos/Frytkownica/hitster_expansion/releases/latest")
                    .openConnection() as HttpURLConnection
                connection.connectTimeout = 15000
                connection.readTimeout = 20000
                connection.setRequestProperty("Accept", "application/vnd.github+json")
                connection.setRequestProperty("User-Agent", "Hitster-Ultimate-Android")
                val release = connection.inputStream.bufferedReader().use { JSONObject(it.readText()) }
                connection.disconnect()

                val version = release.getString("tag_name").removePrefix("v").removePrefix("V")
                val installedVersion = packageManager.getPackageInfo(packageName, 0).versionName ?: "0"
                if (compareVersions(version, installedVersion) <= 0) {
                    if (!automatic) notifyUpdate("current", "Masz aktualną wersję ($installedVersion).")
                    return@execute
                }

                val assets = release.getJSONArray("assets")
                val apkUrl = (0 until assets.length())
                    .map { assets.getJSONObject(it) }
                    .firstOrNull {
                        it.optString("name").endsWith(".apk", ignoreCase = true) &&
                            !it.optString("name").contains("unsigned", ignoreCase = true)
                    }
                    ?.getString("browser_download_url")
                    ?: error("Najnowsze wydanie nie zawiera pliku APK.")

                if (automatic) {
                    runOnUiThread {
                        AlertDialog.Builder(this)
                            .setTitle("Aktualizacja dostępna")
                            .setMessage("Dostępna jest wersja $version. Czy chcesz ją zainstalować?")
                            .setPositiveButton("OK") { _, _ -> downloadAndInstall(version, apkUrl) }
                            .setNegativeButton("Później", null)
                            .show()
                    }
                    return@execute
                }

                downloadAndInstall(version, apkUrl)
            } catch (error: Exception) {
                if (!automatic) {
                    notifyUpdate("error", "Nie udało się sprawdzić lub pobrać aktualizacji: ${error.localizedMessage ?: "błąd sieci"}")
                }
            }
        }
    }

    private fun downloadAndInstall(version: String, apkUrl: String) {
        updateExecutor.execute {
            try {

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !packageManager.canRequestPackageInstalls()) {
                    notifyUpdate("permission", "Zezwól aplikacji na instalowanie nieznanych aplikacji, a następnie sprawdź ponownie.")
                    runOnUiThread {
                        startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:$packageName")))
                    }
                    return@execute
                }

                notifyUpdate("downloading", "Pobieranie wersji $version…")
                val target = File(cacheDir, "updates/hitster-update.apk")
                target.parentFile?.mkdirs()
                val download = URL(apkUrl).openConnection() as HttpURLConnection
                download.connectTimeout = 15000
                download.readTimeout = 30000
                download.inputStream.use { input -> target.outputStream().use { output -> input.copyTo(output) } }
                download.disconnect()

                val uri = FileProvider.getUriForFile(this, "$packageName.fileprovider", target)
                val installIntent = Intent(Intent.ACTION_VIEW)
                    .setDataAndType(uri, "application/vnd.android.package-archive")
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
                runOnUiThread {
                    startActivity(installIntent)
                    notifyUpdate("install", "Pobieranie ukończone. Potwierdź instalację w systemowym oknie Androida.")
                }
            } catch (error: Exception) {
                notifyUpdate("error", "Nie udało się sprawdzić lub pobrać aktualizacji: ${error.localizedMessage ?: "błąd sieci"}")
            }
        }
    }

    private fun compareVersions(left: String, right: String): Int {
        val leftParts = left.substringBefore('-').split('.').map { it.toIntOrNull() ?: 0 }
        val rightParts = right.substringBefore('-').split('.').map { it.toIntOrNull() ?: 0 }
        for (index in 0 until maxOf(leftParts.size, rightParts.size)) {
            val result = (leftParts.getOrElse(index) { 0 }).compareTo(rightParts.getOrElse(index) { 0 })
            if (result != 0) return result
        }
        return 0
    }

    private inner class GamePreviewBridge {
        @JavascriptInterface
        fun play(trackId: String) = runOnUiThread { playPreview(trackId) }

        @JavascriptInterface
        fun stop() = runOnUiThread(::stopPreview)
    }

    private inner class UpdateBridge {
        @JavascriptInterface
        fun checkForUpdate() = this@MainActivity.checkForUpdate(automatic = false)
    }

    private inner class PreviewEventBridge {
        @JavascriptInterface
        fun onStarted(trackId: String) = runOnUiThread { notifyGame("onStarted", trackId) }

        @JavascriptInterface
        fun onFailed(trackId: String) = runOnUiThread { notifyGame("onFailed", trackId) }
    }
}
