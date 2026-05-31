import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Loader2, AlertCircle } from "lucide-react";
import { useAuth } from "../lib/auth";
import { useI18n } from "../lib/i18n";
import { useMessengerActions, MessengerProvider } from "../lib/messenger";
import { GlassBackground } from "../components/GlassBackground";

// Only allow same-origin paths starting with a single "/" (block "//evil.com")
const safeReturnPath = (p) => {
  if (!p || typeof p !== "string") return null;
  if (!p.startsWith("/")) return null;
  if (p.startsWith("//")) return null;
  return p;
};

const Shell = ({ children }) => (
  <div className="relative min-h-screen flex items-center justify-center p-4">
    <GlassBackground />
    <div
      className="relative w-full max-w-sm rounded-3xl px-6 py-8 text-center"
      style={{ background: "var(--modal-bg)", border: "1px solid rgba(255,255,255,0.1)", boxShadow: "0 24px 64px -16px rgba(59,158,255,0.35)" }}
      data-testid="deep-link-card"
    >
      {children}
    </div>
  </div>
);

const Spinner = ({ t }) => (
  <Shell>
    <Loader2 className="w-6 h-6 text-[#9ABEFF] animate-spin mx-auto" />
    <div className="mt-3 text-sm text-white/75">{t("joining")}</div>
  </Shell>
);

// This component is rendered ONLY when MessengerProvider is mounted (i.e. user is logged in).
const JoinExecutor = ({ mode, token, handle }) => {
  const { joinConversation, setActiveConv } = useMessengerActions();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const body = mode === "token" ? { invite_token: token } : { handle };
        if (!body.invite_token && !body.handle) {
          if (!cancelled) setError(mode === "token" ? t("linkInvalidLong") : t("handleNotFoundLong"));
          return;
        }
        const conv = await joinConversation(body);
        if (cancelled) return;
        try { setActiveConv(conv.id); } catch {}
        navigate("/", { replace: true });
      } catch (e) {
        if (cancelled) return;
        const code = e?.response?.status;
        if (code === 404) setError(mode === "token" ? t("linkInvalidLong") : t("handleNotFoundLong"));
        else setError(e?.response?.data?.detail || e.message);
      }
    })();
    return () => { cancelled = true; };
  }, [mode, token, handle, joinConversation, setActiveConv, navigate, t]);

  if (error) {
    return (
      <Shell>
        <AlertCircle className="w-7 h-7 text-red-300 mx-auto" />
        <div className="mt-3 text-sm text-white/85" data-testid="deep-link-error">{error}</div>
        <button
          onClick={() => navigate("/", { replace: true })}
          className="mt-5 px-4 py-1.5 rounded-xl text-sm text-white"
          style={{ background: "linear-gradient(135deg,#3B9EFF,#A78BFA)" }}
          data-testid="deep-link-go-home"
        >
          {t("goToHome")}
        </button>
      </Shell>
    );
  }
  return <Spinner t={t} />;
};

const DeepLinkPage = ({ mode }) => {
  const params = useParams();
  const token = params.token || "";
  const handle = params.handle || "";
  const { user, loading } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const returnPath = mode === "token" ? `/join/${token}` : `/c/${handle}`;

  useEffect(() => {
    if (loading) return;
    if (!user) {
      navigate(`/login?return=${encodeURIComponent(returnPath)}`, { replace: true });
    }
  }, [loading, user, navigate, returnPath]);

  if (loading || !user) {
    return <Spinner t={t} />;
  }
  return (
    <MessengerProvider>
      <JoinExecutor mode={mode} token={token} handle={handle} />
    </MessengerProvider>
  );
};

export const JoinByTokenPage = () => <DeepLinkPage mode="token" />;
export const JoinByHandlePage = () => <DeepLinkPage mode="handle" />;
export { safeReturnPath };
