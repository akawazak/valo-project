package com.akawazak.valovault

import android.os.Bundle
import android.view.ViewGroup
import android.widget.ImageView
import androidx.activity.enableEdgeToEdge
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    installSplashScreen()
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)

    val launchOverlay = ImageView(this).apply {
      setBackgroundColor(getColor(R.color.vv_background))
      setImageResource(R.mipmap.ic_launcher_foreground)
      scaleType = ImageView.ScaleType.CENTER
      contentDescription = getString(R.string.app_name)
    }
    val content = findViewById<ViewGroup>(android.R.id.content)
    content.addView(
      launchOverlay,
      ViewGroup.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.MATCH_PARENT,
      ),
    )
    launchOverlay.postDelayed({
      launchOverlay
        .animate()
        .alpha(0f)
        .setDuration(180L)
        .withEndAction { content.removeView(launchOverlay) }
        .start()
    }, 1_650L)
  }
}
