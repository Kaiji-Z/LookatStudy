package com.lookatstudy.launcher

import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.net.Uri
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.browser.customtabs.CustomTabsIntent

/**
 * 「打开 LookatStudy」:探测 127.0.0.1:17890 → Custom Tab 打开应用。
 * 服务没起 → 引导页(回 Termux 执行 node server.cjs)。token 由网页端令牌门处理,
 * 用户从 Termux 启动日志复制一次即长期有效(serve-token 落盘复用)。
 */
class WebUiActivity : AppCompatActivity() {

    companion object {
        private const val PORT = 17890
        private const val BG = "#0E2A12"
        private const val BRAND = "#58CC02"
        private const val INK_DIM = "#8FB99B"
        private const val INK = "#F2FFF4"
    }

    private lateinit var loadingView: View

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        loadingView = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(Color.parseColor(BG))
            addView(ProgressBar(this@WebUiActivity).apply {
                indeterminateTintList = ColorStateList.valueOf(Color.parseColor(BRAND))
            })
            addView(TextView(this@WebUiActivity).apply {
                text = "正在连接学习服务…"
                setTextColor(Color.parseColor(INK_DIM))
                textSize = 14f
                setPadding(0, 48, 0, 0)
            })
        }
        setContentView(loadingView)

        Thread {
            val reachable = try {
                val socket = java.net.Socket()
                try {
                    socket.connect(java.net.InetSocketAddress("127.0.0.1", PORT), 2000)
                    true
                } finally {
                    socket.close()
                }
            } catch (_: Exception) {
                false
            }

            runOnUiThread {
                if (isFinishing || isDestroyed) return@runOnUiThread
                if (reachable) launchCustomTabs() else showError()
            }
        }.start()
    }

    private fun launchCustomTabs() {
        try {
            val intent = CustomTabsIntent.Builder()
                .setToolbarColor(Color.parseColor(BG))
                .setNavigationBarColor(Color.parseColor(BG))
                .setShowTitle(false)
                .setUrlBarHidingEnabled(false)
                .build()

            try {
                intent.launchUrl(this, Uri.parse("http://127.0.0.1:$PORT/"))
                finish()
            } catch (_: android.content.ActivityNotFoundException) {
                Toast.makeText(this, "请安装 Chrome 浏览器", Toast.LENGTH_LONG).show()
                finish()
            }
        } catch (e: Exception) {
            Toast.makeText(this, "无法打开 LookatStudy: ${e.message}", Toast.LENGTH_LONG).show()
            finish()
        }
    }

    private fun showError() {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(Color.parseColor(BG))
            setPadding(48, 0, 48, 0)
        }

        val title = TextView(this).apply {
            text = "学习服务还没启动"
            setTextColor(Color.parseColor(INK))
            textSize = 16f
            setPadding(0, 0, 0, 12)
        }

        val desc = TextView(this).apply {
            text = "请回到 Termux 执行：\n\ncd ~/lookatstudy\nnode server.cjs\n\n首次启动会打印一个带 token 的链接，在浏览器打开它即可(只需一次)。"
            setTextColor(Color.parseColor(INK_DIM))
            textSize = 13f
            typeface = Typeface.MONOSPACE
        }

        val retry = Button(this).apply {
            text = "重试"
            setBackgroundColor(Color.parseColor(BRAND))
            setTextColor(Color.parseColor(BG))
            setOnClickListener { recreate() }
        }

        root.addView(title)
        root.addView(desc)
        root.addView(retry)
        setContentView(root)
    }
}
