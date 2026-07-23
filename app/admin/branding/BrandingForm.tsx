"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PALETTE_KEYS, type SiteSettings, type PaletteKey } from "@/lib/site-settings";

const LABELS: Record<PaletteKey, string> = {
  bg: "Background",
  panel: "Panel",
  panel2: "Panel (raised)",
  border: "Border",
  text: "Text",
  muted: "Muted text",
  accent: "Accent",
  accent2: "Accent 2",
  hot: "Hot / alert",
  warm: "Warm",
  cool: "Cool / success",
};

export function BrandingForm({ initial }: { initial: SiteSettings }) {
  const router = useRouter();
  const [brandName, setBrandName] = useState(initial.brand_name);
  const [tagline, setTagline] = useState(initial.tagline);
  const [colors, setColors] = useState<Record<PaletteKey, string>>(() => {
    const c = {} as Record<PaletteKey, string>;
    for (const k of PALETTE_KEYS) c[k] = initial[k];
    return c;
  });
  const [logoUrl, setLogoUrl] = useState<string | null>(initial.logo_url);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [removeLogo, setRemoveLogo] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const previewLogo = logoFile ? URL.createObjectURL(logoFile) : removeLogo ? null : logoUrl;

  function setColor(k: PaletteKey, v: string) {
    setColors((c) => ({ ...c, [k]: v }));
  }

  function onPickLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setLogoFile(f);
    if (f) setRemoveLogo(false);
  }

  async function publish() {
    setSaving(true);
    setMsg(null);
    try {
      const fd = new FormData();
      fd.set("brand_name", brandName);
      fd.set("tagline", tagline);
      for (const k of PALETTE_KEYS) fd.set(k, colors[k]);
      fd.set("current_logo_url", initial.logo_url ?? "");
      if (removeLogo) fd.set("remove_logo", "1");
      if (logoFile) fd.set("logo", logoFile);

      const res = await fetch("/api/admin/branding", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Publish failed");
      setLogoUrl(data.logo_url ?? null);
      setLogoFile(null);
      setRemoveLogo(false);
      if (fileRef.current) fileRef.current.value = "";
      setMsg({ kind: "ok", text: "Published, live across the site." });
      router.refresh();
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "Publish failed" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="adm-brandgrid">
      <div className="card adm-brandcard">
        <h3>Identity</h3>
        <label className="adm-flabel">
          Brand name
          <input value={brandName} onChange={(e) => setBrandName(e.target.value)} maxLength={60} />
        </label>
        <label className="adm-flabel">
          Tagline
          <input value={tagline} onChange={(e) => setTagline(e.target.value)} maxLength={160} />
        </label>

        <div className="adm-flabel">Logo</div>
        <div className="adm-logo">
          <div className="adm-logoprev">
            {previewLogo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={previewLogo} alt="Logo preview" />
            ) : (
              <span className="adm-logonone">Built-in mark</span>
            )}
          </div>
          <div className="adm-logobtns">
            <input ref={fileRef} type="file" accept="image/*" onChange={onPickLogo} />
            {(logoUrl || logoFile) && !removeLogo && (
              <button
                type="button"
                className="ghost sm"
                onClick={() => {
                  setLogoFile(null);
                  setRemoveLogo(true);
                  if (fileRef.current) fileRef.current.value = "";
                }}
              >
                Remove logo
              </button>
            )}
            {removeLogo && <span className="adm-hint">Logo will be removed on publish.</span>}
          </div>
        </div>
      </div>

      <div className="card adm-brandcard">
        <h3>Color theme</h3>
        <div className="adm-colors">
          {PALETTE_KEYS.map((k) => (
            <label className="adm-color" key={k}>
              <span>{LABELS[k]}</span>
              <div className="adm-colorrow">
                <input
                  type="color"
                  value={colors[k]}
                  onChange={(e) => setColor(k, e.target.value)}
                />
                <input
                  className="adm-hex"
                  value={colors[k]}
                  onChange={(e) => setColor(k, e.target.value)}
                  spellCheck={false}
                />
              </div>
            </label>
          ))}
        </div>
      </div>

      <div className="adm-publishbar">
        {msg && <span className={`adm-msg ${msg.kind}`}>{msg.text}</span>}
        <button className="go" type="button" onClick={publish} disabled={saving}>
          {saving ? "Publishing…" : "Publish to live site"}
        </button>
      </div>
    </div>
  );
}
