"use client";

import { motion } from 'framer-motion';

export default function TermsPage() {
  const supportEmail = process.env.NEXT_PUBLIC_SUPPORT_EMAIL || 'support@poofpass.com';
  return (
    <motion.article className="prose dark:prose-invert max-w-none" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <h1>Terms of Service</h1>
      <p>Welcome to PoofPass. By using our service, you agree to the following terms.</p>
      <h2>Use of Service</h2>
      <p>PoofPass provides disposable passwords and related tooling. You agree not to misuse the service or attempt to disrupt it.</p>
      <h2>Billing</h2>
      <p>Paid plans are billed via Stripe on a recurring basis. You may cancel anytime via your billing portal.</p>
      <h2>Liability</h2>
      <p>PoofPass is provided "as is" without warranties. To the extent permitted by law, we disclaim liability for damages arising from use of the service.</p>
      <h2>Contact</h2>
      <p>Questions about these terms? Contact us at <a href={`mailto:${supportEmail}`}>{supportEmail}</a>.</p>
      <p className="text-xs text-gray-500">Last updated {new Date().toLocaleDateString()}.</p>
    </motion.article>
  );
}


