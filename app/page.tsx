"use client";

import { useState, useRef } from 'react';
import { motion, useScroll, useTransform } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Shield, RefreshCw, KeyRound, Zap, Copy } from 'lucide-react';

export default function Home() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const y1 = useTransform(scrollYProgress, [0, 1], [0, -30]);
  const y2 = useTransform(scrollYProgress, [0, 1], [0, 30]);
  return (
    <section ref={ref} className="relative py-20">
      <AuroraBackground y1={y1 as any} y2={y2 as any} />

      <div className="relative text-center space-y-4">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
          <Badge className="mx-auto">Hashword · Rotate-on-use secrets</Badge>
        </motion.div>
        <motion.h1
          className="text-4xl md:text-5xl font-bold"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.05 }}
        >
          Disposable passwords made simple
        </motion.h1>
        <motion.p
          className="text-gray-600 max-w-2xl mx-auto"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.15 }}
        >
          Create one-time-use secrets that automatically rotate after use. Reduce credential sprawl and add a zero-trust layer to your workflows.
        </motion.p>
        <motion.div
          className="flex items-center justify-center gap-3"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.25 }}
        >
          <Button onClick={() => (window.location.href = '/pricing')} className="bg-blue-600">View Pricing</Button>
          <Button variant="outline" onClick={() => (window.location.href = '/login')}>Get Started</Button>
        </motion.div>
      </div>

      <Separator className="my-12" />

      <motion.div
        className="grid md:grid-cols-3 gap-6"
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, amount: 0.3 }}
        variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.08 } } }}
      >
        <Feature icon={<KeyRound className="h-5 w-5" />} title="Disposable secrets" desc="Generate a secret and auto-rotate on use — always fresh." />
        <Feature icon={<RefreshCw className="h-5 w-5" />} title="One active per label" desc="Enforced by the DB so you never have stale credentials." />
        <Feature icon={<Shield className="h-5 w-5" />} title="Zero-trust checks" desc="Issue hashed credentials for internal jobs and verify/rotate via API." />
      </motion.div>

      <div className="mt-16 grid lg:grid-cols-2 gap-6">
        <motion.div initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6 }}>
          <CodeCard />
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6, delay: 0.1 }}>
          <Testimonial />
        </motion.div>
      </div>

      <HowItWorks />
    </section>
  );
}

function Feature({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <motion.div
      className="rounded-lg border p-4 bg-white/50 dark:bg-white/5"
      variants={{ hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0 } }}
    >
      <div className="flex items-center gap-2 font-medium">{icon} {title}</div>
      <p className="text-sm text-gray-600 mt-2 dark:text-gray-400">{desc}</p>
    </motion.div>
  )
}

function HowItWorks() {
  return (
    <section className="mt-20">
      <h2 className="text-2xl font-semibold text-center">How it works</h2>
      <div className="mt-8 grid md:grid-cols-3 gap-6">
        <Step num={1} title="Create a secret" code={`POST /api/passwords\n{ "label": "MY_SERVICE" }`} />
        <Step num={2} title="Use it once" code={`PATCH /api/passwords/:id\n# marks used and rotates new`} />
        <Step num={3} title="Verify checks" code={`POST /api/check/verify\n{ "id": "$CRED_ID", "secret": "$SECRET" }`} />
      </div>
    </section>
  );
}

function Step({ num, title, code }: { num: number; title: string; code: string }) {
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.5 }} className="rounded-lg border p-4">
      <div className="text-xs text-gray-500">Step {num}</div>
      <div className="font-medium mt-1">{title}</div>
      <pre className="mt-3 overflow-auto rounded-md bg-black text-white p-3 text-xs">{code}</pre>
    </motion.div>
  );
}

function CodeCard() {
  const [copied, setCopied] = useState(false);
  const code = `curl -X POST https://app.poofpass.com/api/check/verify \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer $TOKEN" \\
  -d '{"id":"$CRED_ID","secret":"$SECRET","rotate":true}'`;

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium"><Zap className="h-4 w-4" /> Quickstart</div>
        <Button size="sm" variant="outline" onClick={onCopy} aria-label="Copy example">
          <Copy className="h-4 w-4 mr-1" /> {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <pre className="mt-3 overflow-auto rounded-md bg-black text-white p-4 text-xs">
{code}
      </pre>
    </div>
  );
}

function Testimonial() {
  return (
    <div className="rounded-lg border p-6 bg-white/50 dark:bg-white/5">
      <div className="text-sm uppercase tracking-wide text-gray-500">Trusted by devs</div>
      <blockquote className="mt-3 text-lg font-medium">“PoofPass let us ship secret rotation in a day instead of a sprint.”</blockquote>
      <div className="mt-4 flex items-center gap-3">
        <div className="h-10 w-10 rounded-full bg-gradient-to-br from-blue-400 to-purple-600" />
        <div className="text-sm">
          <div className="font-medium">Alex Rivera</div>
          <div className="text-gray-500">Infra Lead, SideQuest</div>
        </div>
      </div>
    </div>
  );
}

function AuroraBackground({ y1, y2 }: { y1?: any; y2?: any }) {
  return (
    <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      <motion.div
        className="absolute -top-32 left-1/2 h-[480px] w-[480px] -translate-x-1/2 rounded-full blur-3xl"
        style={{ background: 'radial-gradient(closest-side, rgba(59,130,246,0.25), transparent)', y: y1 }}
        animate={{ y: [0, 10, 0] }}
        transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute top-24 right-1/4 h-[360px] w-[360px] rounded-full blur-3xl"
        style={{ background: 'radial-gradient(closest-side, rgba(168,85,247,0.2), transparent)', y: y2 }}
        animate={{ y: [0, -12, 0] }}
        transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
      />
    </div>
  );
}
