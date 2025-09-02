"use client";

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

export default function PricingPage() {
  const [loading, setLoading] = useState(false);

  const upgrade = async () => {
    setLoading(true);
    window.location.href = '/api/checkout';
  };

  return (
    <main className="max-w-5xl mx-auto p-6 space-y-8">
      <header className="text-center space-y-2">
        <motion.h1 className="text-3xl font-bold" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>Pricing</motion.h1>
        <motion.p className="text-gray-600" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>Start free. Upgrade when you need more power.</motion.p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
          <Card>
            <div className="p-4 space-y-3">
              <h2 className="text-xl font-semibold">Free</h2>
              <div className="text-3xl font-bold">$0<span className="text-base font-normal text-gray-500">/mo</span></div>
              <ul className="text-sm space-y-2">
                <li>• Up to 10 active secrets</li>
                <li>• 1 active secret per label</li>
                <li>• Up to 3 check credentials</li>
                <li>• Basic event history</li>
              </ul>
            </div>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
          <Card>
            <div className="p-4 space-y-3">
              <h2 className="text-xl font-semibold">Pro</h2>
              <div className="text-3xl font-bold">$9<span className="text-base font-normal text-gray-500">/mo</span></div>
              <ul className="text-sm space-y-2">
                <li>• Higher limits</li>
                <li>• Priority support</li>
                <li>• Team-ready entitlements</li>
                <li>• More coming soon</li>
              </ul>
              <Button onClick={upgrade} disabled={loading}>Upgrade</Button>
            </div>
          </Card>
        </motion.div>
      </div>
    </main>
  );
}

