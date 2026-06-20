import { useEffect, type ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { ArrowRight, Check, Copy, Gift, MonitorDown, Sparkles } from "lucide-react";
import { appStoreUrl, playStoreUrl, webAppUrl } from "~/downloads";
import { pageMeta } from "~/meta";
import "~/styles.css";

export const Route = createFileRoute("/invite/$code")({
  head: ({ params }) =>
    pageMeta(
      "Join Doya",
      "Accept a Doya invite and claim AI usage credit for your account.",
      `/invite/${params.code}`,
    ),
  component: InviteLanding,
});

function InviteLanding() {
  const { code } = Route.useParams();
  const normalizedCode = code.trim().toUpperCase();
  const appInviteUrl = `doya://invite/${encodeURIComponent(normalizedCode)}`;
  const webInviteUrl = `${webAppUrl}/invite/${encodeURIComponent(normalizedCode)}`;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      window.location.href = appInviteUrl;
    }, 450);
    return () => window.clearTimeout(timer);
  }, [appInviteUrl]);

  async function copyCode() {
    await navigator.clipboard?.writeText(normalizedCode);
  }

  return (
    <main className="min-h-screen overflow-hidden bg-[#f7faf7] text-[#171a18]">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute -top-32 right-[-8rem] h-96 w-96 rounded-full bg-emerald-100/70 blur-3xl" />
        <div className="absolute top-24 left-[-10rem] h-80 w-80 rounded-full bg-sky-100/70 blur-3xl" />
        <div className="absolute bottom-[-12rem] left-1/2 h-96 w-96 -translate-x-1/2 rounded-full bg-amber-100/60 blur-3xl" />
      </div>

      <section className="relative mx-auto flex min-h-screen w-full max-w-6xl flex-col justify-center px-6 py-12 md:px-10">
        <div className="mb-8 inline-flex w-fit items-center gap-3 rounded-full border border-emerald-200 bg-white/80 px-4 py-2 text-sm font-medium text-emerald-800 shadow-sm backdrop-blur">
          <Sparkles className="h-4 w-4 text-amber-500" />
          Doya invite
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.08fr_0.92fr] lg:items-stretch">
          <div className="relative overflow-hidden rounded-[2rem] border border-white bg-white/85 p-8 shadow-[0_24px_80px_rgba(23,26,24,0.10)] backdrop-blur md:p-10">
            <div className="absolute right-10 top-10 hidden h-28 w-28 rounded-full border border-emerald-200/80 md:block" />
            <div className="absolute bottom-[-7rem] right-[-3rem] h-64 w-64 rounded-full bg-emerald-50" />
            <div className="relative max-w-2xl">
              <div className="mb-8 flex h-16 w-16 items-center justify-center rounded-3xl bg-emerald-100 text-emerald-700">
                <Gift className="h-8 w-8" />
              </div>
              <h1 className="text-4xl font-semibold tracking-tight md:text-6xl">
                Accept your Doya invite.
              </h1>
              <p className="mt-5 max-w-xl text-lg leading-8 text-zinc-600">
                Open Doya to bind this invite code and claim AI usage credit for your account.
              </p>

              <div className="mt-10 rounded-3xl border border-zinc-200 bg-zinc-50/80 p-4">
                <p className="text-xs font-medium uppercase tracking-[0.18em] text-zinc-500">
                  Invite code
                </p>
                <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <code className="break-all text-2xl font-semibold tracking-tight text-zinc-950">
                    {normalizedCode}
                  </code>
                  <button
                    type="button"
                    onClick={copyCode}
                    className="inline-flex items-center justify-center gap-2 rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm font-medium text-zinc-800 transition hover:border-zinc-300 hover:bg-zinc-50"
                  >
                    <Copy className="h-4 w-4" />
                    Copy
                  </button>
                </div>
              </div>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <a
                  href={appInviteUrl}
                  className="inline-flex items-center justify-center gap-3 rounded-2xl bg-emerald-700 px-5 py-4 font-medium text-white transition hover:bg-emerald-800"
                >
                  Open Doya
                  <ArrowRight className="h-4 w-4" />
                </a>
                <a
                  href={webInviteUrl}
                  className="inline-flex items-center justify-center gap-3 rounded-2xl border border-zinc-200 bg-white px-5 py-4 font-medium text-zinc-900 transition hover:border-zinc-300 hover:bg-zinc-50"
                >
                  Open web app
                </a>
              </div>
            </div>
          </div>

          <aside className="relative overflow-hidden rounded-[2rem] border border-emerald-200 bg-emerald-50/90 p-8 shadow-[0_24px_80px_rgba(23,26,24,0.08)] md:p-10">
            <InviteIllustration />
            <div className="relative mt-8 space-y-4">
              <Step icon={<Check className="h-4 w-4" />} title="Open Doya" />
              <Step icon={<Check className="h-4 w-4" />} title="Log in with your account" />
              <Step icon={<Check className="h-4 w-4" />} title="Invite code binds automatically" />
            </div>
            <div className="relative mt-8 rounded-3xl border border-emerald-200 bg-white/80 p-5">
              <div className="flex items-start gap-4">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-100 text-amber-600">
                  <MonitorDown className="h-5 w-5" />
                </div>
                <div>
                  <p className="font-medium text-zinc-950">Need the app?</p>
                  <p className="mt-1 text-sm leading-6 text-zinc-600">
                    Install Doya first, then reopen this invite link.
                  </p>
                </div>
              </div>
              <div className="mt-5 grid grid-cols-2 gap-2">
                <a
                  href={appStoreUrl}
                  className="rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-center text-sm font-medium text-zinc-800 transition hover:bg-zinc-50"
                >
                  App Store
                </a>
                <a
                  href={playStoreUrl}
                  className="rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-center text-sm font-medium text-zinc-800 transition hover:bg-zinc-50"
                >
                  Google Play
                </a>
              </div>
            </div>
          </aside>
        </div>
      </section>
    </main>
  );
}

function Step({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-white/70 px-4 py-3 text-sm font-medium text-zinc-800">
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
        {icon}
      </span>
      {title}
    </div>
  );
}

function InviteIllustration() {
  return (
    <div className="relative h-64">
      <div className="absolute right-0 top-0 h-48 w-48 rounded-full bg-sky-100" />
      <div className="absolute left-2 top-6 h-40 w-40 rounded-full border border-amber-200" />
      <div className="absolute right-12 top-10 h-24 w-24 rounded-[2rem] border border-emerald-200 bg-white/50" />
      <div className="absolute bottom-2 left-8 right-4 rounded-[2rem] border border-zinc-200 bg-white p-6 shadow-xl shadow-emerald-900/10">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700">
          <Sparkles className="h-6 w-6 text-amber-500" />
        </div>
        <div className="mt-5 h-3 w-40 rounded-full bg-sky-100" />
        <div className="mt-3 h-3 w-28 rounded-full bg-amber-100" />
      </div>
      <div className="absolute bottom-8 right-0 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-700 text-white shadow-lg shadow-emerald-900/20">
        <Gift className="h-7 w-7" />
      </div>
    </div>
  );
}
