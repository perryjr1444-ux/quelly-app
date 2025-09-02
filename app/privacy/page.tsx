"use client";

import { motion } from 'framer-motion';

export default function PrivacyPage() {
  const supportEmail = process.env.NEXT_PUBLIC_SUPPORT_EMAIL || 'support@poofpass.com';
  return (
    <motion.article className="prose dark:prose-invert max-w-none" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <h1>Privacy Policy</h1>
      <p>We collect only the data necessary to operate PoofPass, including account information and usage needed for security and billing.</p>
      <h2>Analytics</h2>
      <p>We use PostHog to understand product usage. You can opt out via your browser’s Do Not Track settings.</p>
      <h2>Error Monitoring</h2>
      <p>We use Sentry to capture errors and improve reliability.</p>
      <h2>Data Retention</h2>
      <p>We retain data for as long as your account is active or as needed to provide the service.</p>
      <h2>Contact</h2>
      <p>Privacy questions? Contact <a href={`mailto:${supportEmail}`}>{supportEmail}</a>.</p>
      <p className="text-xs text-gray-500">Last updated {new Date().toLocaleDateString()}.</p>
    </motion.article>
  );
}


