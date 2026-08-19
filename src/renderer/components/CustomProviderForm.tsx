/**
 * CustomProviderForm —— 自定义 provider 新建表单(v0.15 抽共享)。
 *
 * 与主模型区的自定义配置是同一套方法:名字 + 协议 + Base URL + 模型 + 密钥 + 测试。
 * kind 决定落库分区(custom_providers.kind):主模型=llm / 看图=vision /
 * 朗读=tts(OpenAI 兼容 /audio/speech)/ 听写=asr(OpenAI 兼容 /audio/transcriptions)。
 * tts/asr 固定 openai-compatible 协议(隐藏选择),测试走各自的专用探活;
 * llm/vision 走 LLM 连通测试。保存成功后把整个 provider 交回 onSaved。
 */
import { useState } from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import type { CustomProvider, CustomProviderKind } from "@shared/types";
import { api } from "../lib/api.js";
import { useLang } from "../lib/i18n.js";

const fieldCls =
  "bg-ink/[0.04] text-ink-strong text-label rounded-lg border border-transparent focus:border-accent focus:bg-ink/[0.06] transition-colors placeholder:text-ink-faint";

export interface CustomProviderFormProps {
  kind: CustomProviderKind;
  /** 显示协议下拉(llm/vision);tts/asr 固定 openai-compatible 隐藏 */
  showProtocol?: boolean;
  /** testid 前缀(多表单不同屏撞 id):main=custom / vision=vision-custom / tts=tts-custom / asr=asr-custom */
  testPrefix?: string;
  /** 表单标题 i18n key */
  titleKey?: string;
  /** 模型输入 placeholder 的 i18n key(缺省 settings.custom.model_ph) */
  modelPhKey?: string;
  /** tts/asr 专用测试(表单值直测,未保存先测);缺省走 LLM 连通测试 */
  testOverride?: (input: { baseUrl: string; apiKey: string; model: string }) => Promise<{ ok: boolean; detail: string }>;
  onSaved: (provider: CustomProvider) => void;
  onCancel?: () => void;
}

export function CustomProviderForm({
  kind,
  showProtocol = true,
  testPrefix = "custom",
  titleKey = "settings.custom.form_title",
  modelPhKey = "settings.custom.model_ph",
  testOverride,
  onSaved,
  onCancel,
}: CustomProviderFormProps) {
  const t = useLang();
  const [label, setLabel] = useState("");
  const [protocol, setProtocol] = useState<"openai-compatible" | "anthropic" | "google">("openai-compatible");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; detail: string } | null>(null);

  const handleTest = async () => {
    if (!baseUrl.trim() || !model.trim() || testing) return;
    setTesting(true);
    setTestResult(null);
    try {
      const r = testOverride
        ? await testOverride({ baseUrl: baseUrl.trim(), apiKey: apiKey.trim(), model: model.trim() })
        : await api.testCustomProvider({
            label: label || t("settings.custom.test_label"),
            protocol,
            baseUrl: baseUrl.trim(),
            apiKey: apiKey.trim() || undefined,
            defaultModel: model.trim(),
          });
      setTestResult({ ok: r.ok, detail: r.detail });
    } catch (e) {
      setTestResult({ ok: false, detail: e instanceof Error ? e.message : String(e) });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    if (!label.trim() || !baseUrl.trim() || !model.trim()) return;
    try {
      const created = await api.createCustomProvider({
        label: label.trim(),
        kind,
        protocol: showProtocol ? protocol : "openai-compatible",
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim() || undefined,
        defaultModel: model.trim(),
      });
      onSaved(created);
    } catch {
      /* 忽略(与主模型区同语义) */
    }
  };

  return (
    <div className="space-y-2.5" data-testid={`${testPrefix}-provider-form`}>
      <div className="text-label font-bold text-ink-strong">{t(titleKey)}</div>
      <div className="flex gap-2">
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={t("settings.custom.label_ph")}
          data-testid={`${testPrefix}-label`}
          className={`${fieldCls} flex-1 px-2.5 py-1.5`}
        />
        {showProtocol && (
          <select
            value={protocol}
            onChange={(e) => setProtocol(e.target.value as "openai-compatible" | "anthropic" | "google")}
            data-testid={`${testPrefix}-protocol`}
            className={`${fieldCls} px-2 py-1.5`}
          >
            <option value="openai-compatible">{t("settings.proto.openai")}</option>
            <option value="anthropic">Anthropic</option>
            <option value="google">Google</option>
          </select>
        )}
      </div>
      <input
        type="text"
        value={baseUrl}
        onChange={(e) => setBaseUrl(e.target.value)}
        placeholder={t("settings.custom.baseurl_ph")}
        data-testid={`${testPrefix}-baseurl`}
        className={`${fieldCls} w-full px-2.5 py-1.5 font-mono`}
      />
      <div className="flex gap-2">
        <input
          type="text"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder={t(modelPhKey)}
          data-testid={`${testPrefix}-model`}
          className={`${fieldCls} flex-1 px-2.5 py-1.5 font-mono`}
        />
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={t("settings.custom.apikey_ph")}
          data-testid={`${testPrefix}-apikey`}
          className={`${fieldCls} flex-1 px-2.5 py-1.5`}
        />
      </div>
      {testResult && (
        <div
          className={`text-label rounded p-2 inline-flex items-start gap-1.5 ${
            testResult.ok ? "bg-brand/10 text-brand" : "bg-warning/10 text-warning"
          }`}
        >
          {testResult.ok ? (
            <CheckCircle2 className="w-4 h-4 mt-px shrink-0" aria-hidden="true" />
          ) : (
            <XCircle className="w-4 h-4 mt-px shrink-0" aria-hidden="true" />
          )}
          <span className="break-words">{testResult.detail}</span>
        </div>
      )}
      <div className="flex gap-2">
        <button
          onClick={() => void handleTest()}
          disabled={!baseUrl.trim() || !model.trim() || testing}
          data-testid={`${testPrefix}-test`}
          className="btn-3d-neutral px-3 py-1.5 text-label disabled:opacity-40"
        >
          {testing ? t("settings.testing") : t("settings.test")}
        </button>
        <button
          onClick={() => void handleSave()}
          disabled={!label.trim() || !baseUrl.trim() || !model.trim()}
          data-testid={`${testPrefix}-save`}
          className="btn-3d-brand px-3 py-1.5 text-label disabled:opacity-40"
        >
          {t("settings.custom.save")}
        </button>
        {onCancel && (
          <button onClick={onCancel} className="text-label text-ink-muted hover:text-ink-strong px-3 py-1.5 transition-colors">
            {t("action.cancel")}
          </button>
        )}
      </div>
    </div>
  );
}
