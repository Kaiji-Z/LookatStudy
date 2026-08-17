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
 * 常用操作(KaijiBot 的 Help 模式 + 本应用设计词汇):命令卡片点击复制并跳 Termux。
 * 命令对应 install-termux.sh 落盘的 ~/lookatstudy/{start,stop,status,update}.sh。
 * 电池白名单直接开系统设置;Termux:Boot 复制自启配置并打开 F-Droid。
 */
class HelpActivity : AppCompatActivity() {

    companion object {
        private const val TERMUX_PACKAGE = "com.termux"
        private const val BG = "#0B1F0E"
        private const val CARD = "#143518"
        private const val BRAND = "#58CC02"
        private const val GOLD = "#FFC800"
        private const val ACCENT = "#1CB0F6"
        private const val INK = "#F2FFF4"
        private const val INK_DIM = "#8FB99B"
        private const val INK_FAINT = "#5E8266"
    }

    private data class Cmd(val title: String, val command: String, val tint: String)

    private val serviceCmds = listOf(
        Cmd("查看运行状态", "bash ~/lookatstudy/status.sh", ACCENT),
        Cmd("启动服务", "bash ~/lookatstudy/start.sh", BRAND),
        Cmd("停止服务", "bash ~/lookatstudy/stop.sh", GOLD),
        Cmd("更新到最新版", "bash ~/lookatstudy/update.sh", ACCENT),
    )

    private val infoCmds = listOf(
        Cmd("查看日志(最近 50 行)", "tail -50 ~/lookatstudy/server.log", ACCENT),
        // url.txt 只在 serve-token 落盘后由 start.sh 写,首启竞态可能缺席 → status.sh 兜底显示链接
        Cmd("显示访问链接(带 token)", "cat ~/lookatstudy/url.txt 2>/dev/null || bash ~/lookatstudy/status.sh", BRAND),
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
            setPadding(dp(24), dp(52), dp(24), dp(32))
        }

        // 头部:返回 + 标题
        val header = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        header.addView(TextView(this).apply {
            text = "‹  返回"
            setTextColor(Color.parseColor(INK_DIM))
            textSize = 15f
            setPadding(0, dp(4), dp(16), dp(4))
            background = obtainStyledAttributes(intArrayOf(android.R.attr.selectableItemBackground))
                .getDrawable(0)?.mutate()
            isClickable = true
            setOnClickListener { finish() }
        })
        header.addView(TextView(this).apply {
            text = getString(R.string.help_title)
            setTextColor(Color.parseColor(INK))
            textSize = 20f
            typeface = Typeface.DEFAULT_BOLD
        })
        list.addView(header)
        list.addView(TextView(this).apply {
            text = "点击卡片复制命令,自动跳转 Termux 粘贴执行"
            setTextColor(Color.parseColor(INK_FAINT))
            textSize = 12f
            setPadding(dp(4), dp(6), dp(4), dp(20))
        })

        sectionLabel(list, "服务")
        for (cmd in serviceCmds) {
            list.addView(commandCard(cmd) { copyAndLaunchTermux(cmd.command) }, cardParams())
        }

        sectionLabel(list, "信息")
        for (cmd in infoCmds) {
            list.addView(commandCard(cmd) { copyAndLaunchTermux(cmd.command) }, cardParams())
        }

        sectionLabel(list, "系统")
        list.addView(commandCard(Cmd("电池白名单(后台保活)", "设置 → 应用 → Termux → 不受限制", GOLD)) {
            openBatteryOptimizationSettings()
        }, cardParams())
        list.addView(commandCard(Cmd("开机自启(装 Termux:Boot)", "复制自启配置命令", ACCENT)) {
            openTermuxBootInstall()
        }, cardParams())

        scroll.addView(list)
        root.addView(scroll, LinearLayout.LayoutParams(-1, -1))
        setContentView(root)
    }

    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()

    private fun cardParams(): LinearLayout.LayoutParams =
        LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(8) }

    /** 分组标签:小号暗色,不是大写 eyebrow,只承担分组信息 */
    private fun sectionLabel(parent: LinearLayout, text: String) {
        parent.addView(TextView(this).apply {
            this.text = text
            setTextColor(Color.parseColor(INK_FAINT))
            textSize = 13f
            setPadding(dp(4), dp(14), dp(4), dp(8))
        })
    }

    private fun commandCard(cmd: Cmd, onClick: () -> Unit): View {
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(14), dp(13), dp(14), dp(13))
            background = GradientDrawable().apply {
                setColor(Color.parseColor(CARD))
                cornerRadius = dp(14).toFloat()
            }
            isClickable = true
            isFocusable = true
            foreground = obtainStyledAttributes(intArrayOf(android.R.attr.selectableItemBackground))
                .getDrawable(0)?.mutate()
            setOnClickListener { onClick() }
        }

        // 前导图标:着色圆点(色彩语义:绿=启动/前进,蓝=信息,金=注意)
        card.addView(View(this).apply {
            background = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColor(Color.parseColor(cmd.tint))
            }
        }, LinearLayout.LayoutParams(dp(10), dp(10)).apply { rightMargin = dp(14) })

        val textCol = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        textCol.addView(TextView(this).apply {
            text = cmd.title
            setTextColor(Color.parseColor(INK))
            textSize = 14.5f
        })
        textCol.addView(TextView(this).apply {
            text = cmd.command
            setTextColor(Color.parseColor(INK_DIM))
            textSize = 11.5f
            typeface = Typeface.MONOSPACE
            maxLines = 1
        }, LinearLayout.LayoutParams(-2, -2).apply { topMargin = dp(3) })
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
