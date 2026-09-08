package io.github.davidmay87.stormdesk

import android.os.Bundle
import android.view.View
import android.view.WindowManager
import androidx.activity.enableEdgeToEdge
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    // This app is a wall clock as much as a dashboard: a screen that sleeps after a minute is
    // no use on a shelf. The flag is scoped to this window, so it lapses the moment the app is
    // backgrounded — no wake lock to leak and no permission to ask for.
    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    super.onCreate(savedInstanceState)
    // Keep every page and fixed toolbar inside the system bars, including older WebViews
    // that do not expose CSS safe-area insets. Clear only the insets handled here so the
    // WebView cannot apply them twice; keyboard insets must still reach it.
    val content = findViewById<View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(content) { view, windowInsets ->
      val types = WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
      val bars = windowInsets.getInsets(types)
      view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
      WindowInsetsCompat.Builder(windowInsets).setInsets(types, Insets.NONE).build()
    }
    ViewCompat.requestApplyInsets(content)
  }
}
