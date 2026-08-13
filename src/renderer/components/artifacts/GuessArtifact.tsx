/**
 * GuessArtifact —— hook 起手式的"二选一猜测"按钮卡。
 *
 * 和 QuizArtifact 的本质区别(动机层设计):
 *   - 不计分、无正确答案、不碰掌握度——"猜"是玩,不是考。
 *   - 学习者点一个选项 → 把"我猜:X"发进对话 → AI 下一回合揭晓 + 讲清核心。
 *   - 卡上不做对错判定(没有绿/红),只标记"已猜",把舞台交还给 AI。
 *
 * 这是把"开始学习"的猜测从纯文字升级成一点即猜的按钮(比打字更低门槛,更像 Duolingo)。
 * tool pose_guess 返回 { prompt, options },这里渲染。
 */
import { useState } from "react";
import { Dices, Check } from "lucide-react";
import { useLang } from "../../lib/i18n.js";

interface GuessOption {
  id: string;
  label: string;
}
interface GuessData {
  artifactType: "guess";
  prompt: string;
  options: GuessOption[];
  /** harness 可能注入的修复警告 */
  warnings?: string[];
}

export function GuessArtifact({
  data,
  onPickAction,
}: {
  data: unknown;
  /** 点一个选项 → 把"我猜:X"发进对话(父组件接 sendMessage)。AI 下一回合揭晓。 */
  onPickAction?: (message: string) => void;
}) {
  const d = data as GuessData;
  const t = useLang();
  const [picked, setPicked] = useState<string | null>(null);

  const handlePick = (opt: GuessOption) => {
    if (picked) return; // 已猜,锁定
    setPicked(opt.id);
    onPickAction?.(`${t("guess.pickedPrefix")}${opt.label}`);
  };

  return (
    <div className="surface-card p-4" data-testid="artifact-guess">
      <div className="flex items-center gap-2 mb-3">
        <Dices className="w-4 h-4 text-accent" />
        <span className="text-label font-bold text-accent">{t("guess.header")}</span>
      </div>

      <div className="text-body text-ink font-medium mb-3 leading-relaxed">
        {d.prompt}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
        {d.options.map((opt) => {
          const isPicked = picked === opt.id;
          const disabled = picked !== null;
          return (
            <button
              key={opt.id}
              onClick={() => handlePick(opt)}
              disabled={disabled}
              data-testid={`guess-option-${opt.id}`}
              className={`text-body p-2.5 rounded-lg border-2 font-medium transition-colors text-left flex items-center justify-between gap-2 ${
                isPicked
                  ? "border-accent bg-accent/10 text-accent"
                  : disabled
                    ? "border-[var(--border-faint)] text-ink-faint cursor-default"
                    : "border-[var(--border)] text-ink-muted hover:border-accent hover:text-accent cursor-pointer"
              }`}
            >
              <span>{opt.label}</span>
              {isPicked && <Check className="w-4 h-4 shrink-0" />}
            </button>
          );
        })}
      </div>

      {picked && (
        <div className="text-label text-ink-muted mt-1" data-testid="guess-picked-hint">
          {t("guess.waitReveal")}
        </div>
      )}

      {d.warnings && d.warnings.length > 0 && (
        <div className="mt-2 text-caption text-amber-600 dark:text-amber-400" data-testid="artifact-warnings">
          {d.warnings.join("; ")}
        </div>
      )}
    </div>
  );
}
