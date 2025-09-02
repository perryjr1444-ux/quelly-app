"use client";

import { motion, HTMLMotionProps } from 'framer-motion';
import { cn } from '@/lib/utils';
import { Card } from './card';

interface AnimatedCardProps extends HTMLMotionProps<"div"> {
  children: React.ReactNode;
  delay?: number;
  hover?: boolean;
}

export function AnimatedCard({ 
  children, 
  className, 
  delay = 0, 
  hover = true,
  ...props 
}: AnimatedCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay }}
      whileHover={hover ? { scale: 1.02, transition: { duration: 0.2 } } : undefined}
      className={cn('relative', className)}
      {...props}
    >
      <Card className="h-full overflow-hidden backdrop-blur-sm bg-card/50 border-border/50 shadow-lg">
        {children}
      </Card>
      
      {/* Gradient border effect */}
      <motion.div
        className="absolute inset-0 -z-10 rounded-lg"
        style={{
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          padding: '1px',
        }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 0.5 }}
        whileHover={{ opacity: 1 }}
        transition={{ duration: 0.3 }}
      />
    </motion.div>
  );
}
