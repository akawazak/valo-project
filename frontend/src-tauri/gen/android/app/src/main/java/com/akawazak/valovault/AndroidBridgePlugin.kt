package com.akawazak.valovault

import android.app.Activity
import android.app.Dialog
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.ImageButton
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.net.URI
import java.security.KeyStore
import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

@InvokeArg
class OpenLoginArgs {
  lateinit var authUrl: String
  lateinit var sessionId: String
}

@InvokeArg
class LoginSessionArgs {
  lateinit var sessionId: String
}

@InvokeArg
class RiotSecretsArgs {
  lateinit var puuid: String
  var accessToken: String? = null
  var entitlementsToken: String? = null
  var ssid: String? = null
}

@InvokeArg
class RiotAccountArgs {
  lateinit var puuid: String
}

@TauriPlugin
class AndroidBridgePlugin(private val activity: Activity) : Plugin(activity) {
  private val cookieManager = CookieManager.getInstance()
  private val capturedCookies = mutableMapOf<String, String>()
  private var loginDialog: Dialog? = null
  private var loginWebView: WebView? = null
  private var pendingLogin: Invoke? = null
  private var pendingSessionId: String? = null

  @Command
  fun openLogin(invoke: Invoke) {
    val args = try {
      invoke.parseArgs(OpenLoginArgs::class.java)
    } catch (error: Exception) {
      invoke.reject("Invalid Android login request.")
      return
    }

    if (!isSafeAuthUrl(args.authUrl) || !isValidSessionId(args.sessionId)) {
      invoke.reject("The Riot sign-in request was invalid.")
      return
    }

    activity.runOnUiThread {
      if (pendingLogin != null) {
        invoke.reject("Another Riot sign-in is already open.")
        return@runOnUiThread
      }

      pendingLogin = invoke
      pendingSessionId = args.sessionId
      showLoginDialog(args.authUrl, args.sessionId)
    }
  }

  @Command
  fun showLogin(invoke: Invoke) {
    activity.runOnUiThread {
      loginDialog?.show()
      invoke.resolve()
    }
  }

  @Command
  fun closeLogin(invoke: Invoke) {
    activity.runOnUiThread {
      finishLogin(null, "Login cancelled.")
      invoke.resolve()
    }
  }

  @Command
  fun getLoginCookies(invoke: Invoke) {
    val args = try {
      invoke.parseArgs(LoginSessionArgs::class.java)
    } catch (error: Exception) {
      invoke.reject("Invalid Android login session.")
      return
    }
    if (!isValidSessionId(args.sessionId)) {
      invoke.reject("Invalid Android login session.")
      return
    }
    val response = JSObject()
    response.put("cookies", capturedCookies.remove(args.sessionId))
    invoke.resolve(response)
  }

  @Command
  fun saveSecrets(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(RiotSecretsArgs::class.java)
      validatePuuid(args.puuid)
      val plaintext = JSONObject()
        .put("accessToken", args.accessToken ?: "")
        .put("entitlementsToken", args.entitlementsToken ?: "")
        .put("ssid", args.ssid ?: "")
        .toString()
        .toByteArray(Charsets.UTF_8)

      val cipher = Cipher.getInstance(CIPHER_TRANSFORMATION)
      cipher.init(Cipher.ENCRYPT_MODE, getOrCreateSecretKey())
      cipher.updateAAD(aadFor(args.puuid))
      val ciphertext = cipher.doFinal(plaintext)
      plaintext.fill(0)

      val payload = JSONObject()
        .put("schema", SECRET_SCHEMA)
        .put("nonce", Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
        .put("ciphertext", Base64.encodeToString(ciphertext, Base64.NO_WRAP))
        .toString()
        .toByteArray(Charsets.UTF_8)

      writeAtomically(secretFile(args.puuid), payload)
      payload.fill(0)
      invoke.resolve()
    } catch (error: Exception) {
      invoke.reject("Could not save Riot credentials securely.", error)
    }
  }

  @Command
  fun loadSecrets(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(RiotAccountArgs::class.java)
      validatePuuid(args.puuid)
      val file = secretFile(args.puuid)
      if (!file.isFile) {
        invoke.resolve(emptySecrets())
        return
      }

      val payload = JSONObject(file.readText(Charsets.UTF_8))
      if (payload.optInt("schema") != SECRET_SCHEMA) {
        throw IllegalStateException("Unsupported credential schema.")
      }

      val nonce = Base64.decode(payload.getString("nonce"), Base64.NO_WRAP)
      val ciphertext = Base64.decode(payload.getString("ciphertext"), Base64.NO_WRAP)
      val cipher = Cipher.getInstance(CIPHER_TRANSFORMATION)
      cipher.init(
        Cipher.DECRYPT_MODE,
        getOrCreateSecretKey(),
        GCMParameterSpec(GCM_TAG_BITS, nonce),
      )
      cipher.updateAAD(aadFor(args.puuid))
      val plaintext = cipher.doFinal(ciphertext)
      val secrets = JSONObject(String(plaintext, Charsets.UTF_8))
      plaintext.fill(0)

      val response = JSObject()
      response.put("accessToken", secrets.optString("accessToken").ifBlank { null })
      response.put("entitlementsToken", secrets.optString("entitlementsToken").ifBlank { null })
      response.put("ssid", secrets.optString("ssid").ifBlank { null })
      invoke.resolve(response)
    } catch (error: Exception) {
      invoke.reject("Could not unlock saved Riot credentials.", error)
    }
  }

  @Command
  fun loadChatStorageKey(invoke: Invoke) {
    try {
      val key = loadOrCreateChatStorageKey()
      val response = JSObject()
      response.put("key", Base64.encodeToString(key, Base64.NO_WRAP))
      key.fill(0)
      invoke.resolve(response)
    } catch (error: Exception) {
      invoke.reject("Could not unlock encrypted chat storage.", error)
    }
  }

  @Command
  fun deleteSecrets(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(RiotAccountArgs::class.java)
      validatePuuid(args.puuid)
      val file = secretFile(args.puuid)
      if (file.exists() && !file.delete()) {
        throw IllegalStateException("Credential file could not be deleted.")
      }
      invoke.resolve()
    } catch (error: Exception) {
      invoke.reject("Could not delete saved Riot credentials.", error)
    }
  }

  private fun showLoginDialog(authUrl: String, sessionId: String) {
    cookieManager.setAcceptCookie(true)

    val dialog = Dialog(activity, android.R.style.Theme_Material_NoActionBar)
    val root = LinearLayout(activity).apply {
      orientation = LinearLayout.VERTICAL
      setBackgroundColor(Color.rgb(6, 11, 15))
    }

    val toolbar = LinearLayout(activity).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
      setPadding(dp(18), dp(10), dp(8), dp(10))
      setBackgroundColor(Color.rgb(12, 19, 24))
      elevation = dp(2).toFloat()
    }
    val title = TextView(activity).apply {
      text = "Sign in with Riot"
      setTextColor(Color.rgb(237, 240, 242))
      textSize = 18f
      setTypeface(typeface, android.graphics.Typeface.BOLD)
    }
    val close = ImageButton(activity).apply {
      setImageResource(android.R.drawable.ic_menu_close_clear_cancel)
      setColorFilter(Color.rgb(237, 240, 242))
      background = ColorDrawable(Color.TRANSPARENT)
      contentDescription = "Close Riot sign-in"
      setOnClickListener { finishLogin(null, "Login cancelled.") }
    }
    toolbar.addView(
      title,
      LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f),
    )
    toolbar.addView(close, LinearLayout.LayoutParams(dp(48), dp(48)))

    val webContainer = FrameLayout(activity)
    val progress = ProgressBar(activity).apply {
      isIndeterminate = true
    }
    webContainer.addView(
      progress,
      FrameLayout.LayoutParams(dp(32), dp(32), Gravity.CENTER),
    )

    val webView = WebView(activity)
    configureLoginWebView(webView, sessionId, progress)
    webContainer.addView(
      webView,
      FrameLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.MATCH_PARENT,
      ),
    )
    webView.bringToFront()
    progress.bringToFront()

    root.addView(
      toolbar,
      LinearLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.WRAP_CONTENT,
      ),
    )
    root.addView(
      webContainer,
      LinearLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        0,
        1f,
      ),
    )

    dialog.setContentView(root)
    dialog.setCancelable(true)
    dialog.setOnCancelListener { finishLogin(null, "Login cancelled.") }
    dialog.window?.apply {
      setBackgroundDrawable(ColorDrawable(Color.rgb(6, 11, 15)))
      setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
      statusBarColor = Color.rgb(6, 11, 15)
      navigationBarColor = Color.rgb(6, 11, 15)
    }

    loginDialog = dialog
    loginWebView = webView
    dialog.show()
    dialog.window?.setLayout(
      ViewGroup.LayoutParams.MATCH_PARENT,
      ViewGroup.LayoutParams.MATCH_PARENT,
    )
    webView.loadUrl(authUrl)
  }

  private fun configureLoginWebView(
    webView: WebView,
    sessionId: String,
    progress: ProgressBar,
  ) {
    cookieManager.setAcceptThirdPartyCookies(webView, true)
    webView.setBackgroundColor(Color.WHITE)
    webView.settings.apply {
      javaScriptEnabled = true
      domStorageEnabled = true
      databaseEnabled = true
      allowFileAccess = false
      allowContentAccess = false
      mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
      cacheMode = WebSettings.LOAD_DEFAULT
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        safeBrowsingEnabled = true
      }
    }
    webView.webViewClient = object : WebViewClient() {
      override fun shouldOverrideUrlLoading(
        view: WebView,
        request: WebResourceRequest,
      ): Boolean {
        return handleNavigation(request.url.toString(), sessionId)
      }

      @Suppress("DEPRECATION")
      override fun shouldOverrideUrlLoading(view: WebView, url: String): Boolean {
        return handleNavigation(url, sessionId)
      }

      override fun onPageFinished(view: WebView, url: String) {
        progress.visibility = View.GONE
        handleNavigation(url, sessionId)
      }
    }
  }

  private fun handleNavigation(url: String, sessionId: String): Boolean {
    val uri = try {
      URI(url)
    } catch (_: Exception) {
      return true
    }
    val isRedirect =
      (uri.host.equals("localhost", true) || uri.host == "127.0.0.1") &&
        uri.path == "/redirect"
    if (isRedirect) {
      val cookies = collectRiotCookies(url)
      if (!cookies.contains(Regex("(^|;\\s*)ssid="))) {
        finishLogin(null, "Riot sign-in completed without a reusable session cookie.")
      } else {
        capturedCookies[sessionId] = cookies
        activity.window.decorView.postDelayed(
          { capturedCookies.remove(sessionId) },
          LOGIN_COOKIE_TTL_MS,
        )
        val response = JSObject()
        response.put("sessionId", sessionId)
        response.put("url", url)
        response.put("cookies", cookies)
        finishLogin(response, null)
      }
      return true
    }
    return uri.scheme != "https"
  }

  private fun collectRiotCookies(redirectUrl: String): String {
    val merged = linkedMapOf<String, String>()
    listOf(
      redirectUrl,
      "https://auth.riotgames.com/",
      "https://authenticate.riotgames.com/",
      "https://account.riotgames.com/",
      "https://riotgames.com/",
    ).forEach { url ->
      cookieManager.getCookie(url)
        ?.split(';')
        ?.map { it.trim() }
        ?.filter { it.contains('=') }
        ?.forEach { cookie ->
          val name = cookie.substringBefore('=').trim()
          val value = cookie.substringAfter('=', "").trim()
          if (name.isNotEmpty() && value.isNotEmpty()) merged[name] = value
        }
    }
    return merged.entries.joinToString("; ") { (name, value) -> "$name=$value" }
  }

  private fun finishLogin(response: JSObject?, error: String?) {
    val invoke = pendingLogin
    val sessionId = pendingSessionId
    pendingLogin = null
    pendingSessionId = null
    if (response == null && sessionId != null) {
      capturedCookies.remove(sessionId)
    }

    loginWebView?.apply {
      stopLoading()
      loadUrl("about:blank")
      clearHistory()
      removeAllViews()
      destroy()
    }
    loginWebView = null
    loginDialog?.setOnCancelListener(null)
    loginDialog?.dismiss()
    loginDialog = null
    cookieManager.removeAllCookies(null)
    cookieManager.flush()

    if (invoke != null) {
      if (response != null) invoke.resolve(response) else invoke.reject(error ?: "Login cancelled.")
    }
  }

  private fun isSafeAuthUrl(url: String): Boolean {
    return try {
      val uri = URI(url)
      uri.scheme == "https" &&
        (uri.host.equals("riotgames.com", true) ||
          uri.host?.lowercase()?.endsWith(".riotgames.com") == true)
    } catch (_: Exception) {
      false
    }
  }

  private fun isValidSessionId(sessionId: String): Boolean {
    return sessionId.length <= 128 &&
      sessionId.matches(Regex("^account_[A-Za-z0-9_-]+$|^session_[A-Za-z0-9_-]+$"))
  }

  private fun validatePuuid(puuid: String) {
    if (!puuid.matches(Regex("^[A-Za-z0-9_-]{8,128}$"))) {
      throw IllegalArgumentException("Invalid Riot account ID.")
    }
  }

  private fun getOrCreateSecretKey(): SecretKey {
    val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
    (keyStore.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
    val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE)
    generator.init(
      KeyGenParameterSpec.Builder(
        KEY_ALIAS,
        KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
      )
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setKeySize(256)
        .setRandomizedEncryptionRequired(true)
        .build(),
    )
    return generator.generateKey()
  }

  private fun loadOrCreateChatStorageKey(): ByteArray {
    val file = File(activity.noBackupFilesDir, CHAT_KEY_FILE)
    if (file.isFile) {
      val payload = JSONObject(file.readText(Charsets.UTF_8))
      if (payload.optInt("schema") != CHAT_KEY_SCHEMA) {
        throw IllegalStateException("Unsupported chat key schema.")
      }
      val nonce = Base64.decode(payload.getString("nonce"), Base64.NO_WRAP)
      val ciphertext = Base64.decode(payload.getString("ciphertext"), Base64.NO_WRAP)
      val cipher = Cipher.getInstance(CIPHER_TRANSFORMATION)
      cipher.init(
        Cipher.DECRYPT_MODE,
        getOrCreateSecretKey(),
        GCMParameterSpec(GCM_TAG_BITS, nonce),
      )
      cipher.updateAAD(chatKeyAad())
      return cipher.doFinal(ciphertext)
    }

    val key = ByteArray(CHAT_KEY_BYTES)
    SecureRandom().nextBytes(key)
    val cipher = Cipher.getInstance(CIPHER_TRANSFORMATION)
    cipher.init(Cipher.ENCRYPT_MODE, getOrCreateSecretKey())
    cipher.updateAAD(chatKeyAad())
    val ciphertext = cipher.doFinal(key)
    val payload = JSONObject()
      .put("schema", CHAT_KEY_SCHEMA)
      .put("nonce", Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
      .put("ciphertext", Base64.encodeToString(ciphertext, Base64.NO_WRAP))
      .toString()
      .toByteArray(Charsets.UTF_8)
    writeAtomically(file, payload)
    payload.fill(0)
    return key
  }

  private fun chatKeyAad(): ByteArray {
    return "${activity.packageName}|chat-storage|$CHAT_KEY_SCHEMA".toByteArray(Charsets.UTF_8)
  }

  private fun aadFor(puuid: String): ByteArray {
    return "${activity.packageName}|$SECRET_SCHEMA|$puuid".toByteArray(Charsets.UTF_8)
  }

  private fun secretFile(puuid: String): File {
    val directory = File(activity.noBackupFilesDir, "riot_accounts").apply {
      if (!exists() && !mkdirs()) throw IllegalStateException("Secure storage directory unavailable.")
    }
    val digest = MessageDigest.getInstance("SHA-256")
      .digest(puuid.toByteArray(Charsets.UTF_8))
      .joinToString("") { "%02x".format(it) }
    return File(directory, "$digest.json")
  }

  private fun writeAtomically(destination: File, bytes: ByteArray) {
    val temporary = File(destination.parentFile, "${destination.name}.tmp")
    FileOutputStream(temporary).use { output ->
      output.write(bytes)
      output.fd.sync()
    }
    if (destination.exists() && !destination.delete()) {
      temporary.delete()
      throw IllegalStateException("Old credential file could not be replaced.")
    }
    if (!temporary.renameTo(destination)) {
      temporary.delete()
      throw IllegalStateException("Credential file could not be committed.")
    }
  }

  private fun emptySecrets(): JSObject {
    val response = JSObject()
    response.put("accessToken", null)
    response.put("entitlementsToken", null)
    response.put("ssid", null)
    return response
  }

  private fun dp(value: Int): Int {
    return (value * activity.resources.displayMetrics.density).toInt()
  }

  companion object {
    private const val ANDROID_KEYSTORE = "AndroidKeyStore"
    private const val KEY_ALIAS = "com.akawazak.valovault.riot-secrets.v1"
    private const val CIPHER_TRANSFORMATION = "AES/GCM/NoPadding"
    private const val GCM_TAG_BITS = 128
    private const val SECRET_SCHEMA = 1
    private const val CHAT_KEY_SCHEMA = 1
    private const val CHAT_KEY_BYTES = 32
    private const val CHAT_KEY_FILE = "chat-storage-key.v1.json"
    private const val LOGIN_COOKIE_TTL_MS = 60_000L
  }
}
