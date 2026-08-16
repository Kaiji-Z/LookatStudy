package com.lookatstudy.launcher

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import android.view.Gravity
import android.view.View
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity

/**
 * 常用操作(照搬 KaijiBot 的 Help 模式):命令卡片,点击复制命令并跳 Termux 粘贴执行。
 * 命令对应 install-termux.sh 落盘的 ~/lookatstudy/{start,stop,status,update}.sh。
 * 电池白名单卡片直接开系统设置;Termux:Boot 卡片复制自启脚本安装命令 + 打开 F-Droid。
 */
class HelpActivity : AppCompatActivity() {

    companion object {
        private const val TERMUX_PACKAGE = "com.termux"
        private const val BG = "#0E2A12"
        private const val CARD = "#1E4224"
        private const val BRAND = "#58CC02"
        private const val INK = "#F2FFF4"
        private const val INK_DIM = "#8FB99B"
        private const val MONO = "#9FD48A"
    }

    private data class Cmd(val title: String, val command: String)

    private val commands = listOf(
        Cmd("查看运行状态", "bash ~/lookatstudy/status.sh"),
        Cmd("启动服务", "bash ~/lookatstudy/start.sh"),
        Cmd("停止服务", "bash ~/lookatstudy/stop.sh"),
        Cmd("更新到最新版", "bash ~/lookatstudy/update.sh"),
        Cmd("查看日志(最近 50 行)", "tail -50 ~/lookatstudy/server.log"),
        Cmd("显示访问链接(带 token)", "cat ~/lookatstudy/url.txt"),
    )

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor(BG))
        }
        val scroll = ScrollView(this).apply { setFillViewport(true) }
        val list = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(40), dp(20), dp(32))
        }

        list.addView(TextView(this).apply {
            text = "常用操作"
            setTextColor(Color.parseColor(INK))
            textSize = 20f
            typeface = Typeface.DEFAULT_BOLD
        })
        list.addView(TextView(this).apply {
            text = "点击卡片复制命令,自动跳转 Termux 粘贴执行"
            setTextColor(Color.parseColor(INK_DIM))
            textSize = 12f
            setPadding(0, dp(6), 0, dp(16))
        })

        for (cmd in commands) {
            list.addView(commandCard(cmd.title, cmd.command) { copyAndLaunchTermux(cmd.command) }, cardParams())
        }

        // 特殊卡片:电池白名单(直接开系统设置,不用进 Termux)
        list.addView(commandCard("电池白名单(后台保活)", "设置 → 应用 → Termux → 不受限制") {
            openBatteryOptimizationSettings()
        }, cardParams())

        // 特殊卡片:Termux:Boot 开机自启(复制安装命令 + 打开 F-Droid)
        list.addView(commandCard("开机自启(装 Termux:Boot)", "复制自启配置命令") {
            openTermuxBootInstall()
        }, cardParams())

        scroll.addView(list)
        root.addView(scroll, LinearLayout.LayoutParams(-1, -1))
        setContentView(root)
    }

    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()

    private fun cardParams(): LinearLayout.LayoutParams =
        LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(6) }

    private fun commandCard(title: String, subtitle: String, onClick: () -> Unit): View {
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(14), dp(12), dp(14), dp(12))
            background = GradientDrawable().apply {
                setColor(Color.parseColor(CARD))
                cornerRadius = dp(10).toFloat()
            }
            isClickable = true
            isFocusable = true
            foreground = obtainStyledAttributes(intArrayOf(android.R.attr.selectableItemBackground))
                .getDrawable(0)?.mutate()
            setOnClickListener { onClick() }
        }
        card.addView(ImageView(this).apply {
            setImageResource(R.drawable.ic_dot)
            setColorFilter(Color.parseColor(BRAND))
            setPadding(0, 0, 0, 0)
        }, LinearLayout.LayoutParams(dp(20), dp(20)).apply { rightMargin = dp(12) })

        val textCol = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        textCol.addView(TextView(this).apply {
            text = title
            setTextColor(Color.parseColor(INK))
            textSize = 14f
        })
        textCol.addView(TextView(this).apply {
            text = subtitle
            setTextColor(Color.parseColor(MONO))
            textSize = 11f
            typeface = Typeface.MONOSPACE
            maxLines = 1
        }, LinearLayout.LayoutParams(-2, -2).apply { topMargin = dp(2) })
        card.addView(textCol, LinearLayout.LayoutParams(0, -2, 1f))
        return card
    }

    private fun copyAndLaunchTermux(command: String) {
        val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        clipboard.setPrimaryClip(ClipData.newPlainText("LookatStudy", command))
        Toast.makeText(this, "已复制,请在 Termux 里粘贴并回车", Toast.LENGTH_SHORT).show()

        try {
            val intent = packageManager.getLaunchIntentForPackage(TERMUX_PACKAGE)
            if (intent != null) {
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                startActivity(intent)
            }
        } catch (_: Exception) {
        }
    }

    private fun openBatteryOptimizationSettings() {
        try {
            val intent = Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            startActivity(intent)
        } catch (_: Exception) {
            try {
                val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                    data = Uri.parse("package:$packageName")
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                startActivity(intent)
            } catch (_: Exception) {
                Toast.makeText(this, "无法打开电池设置", Toast.LENGTH_SHORT).show()
            }
        }
    }

    private fun openTermuxBootInstall() {
        copyAndLaunchTermux(
            "mkdir -p ~/.termux/boot && echo 'bash ~/lookatstudy/start.sh' > ~/.termux/boot/start-lookatstudy.sh"
        )
        try {
            val intent = Intent(Intent.ACTION_VIEW, Uri.parse("https://f-droid.org/packages/com.termux.boot/")).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            startActivity(intent)
        } catch (_: Exception) {
            Toast.makeText(this, "打开浏览器失败,命令已复制", Toast.LENGTH_LONG).show()
        }
    }
}
