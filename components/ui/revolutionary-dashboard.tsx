'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { 
  Shield, 
  RotateCcw, 
  Key, 
  TrendingUp, 
  AlertTriangle,
  CheckCircle,
  Clock,
  Globe,
  Zap,
  Lock,
  Unlock,
  RefreshCw,
  Eye,
  EyeOff,
  Activity,
  Target,
  Crown
} from 'lucide-react';

interface RotationStats {
  totalRotations: number;
  successfulRotations: number;
  failedRotations: number;
  averageRotationsPerDay: number;
  mostRotatedService: string;
}

interface RecentRotation {
  id: string;
  service: string;
  reason: string;
  success: boolean;
  timestamp: Date;
  oldPasswordId: string;
  newPasswordId: string;
}

interface ActivePassword {
  id: string;
  label: string;
  service?: string;
  createdAt: Date;
  rotationCount: number;
  status: 'active' | 'rotated';
}

export default function RevolutionaryDashboard() {
  const [rotationStats, setRotationStats] = useState<RotationStats>({
    totalRotations: 0,
    successfulRotations: 0,
    failedRotations: 0,
    averageRotationsPerDay: 0,
    mostRotatedService: 'None'
  });
  
  const [recentRotations, setRecentRotations] = useState<RecentRotation[]>([]);
  const [activePasswords, setActivePasswords] = useState<ActivePassword[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showSensitiveData, setShowSensitiveData] = useState(false);
  
  useEffect(() => {
    loadDashboardData();
    const interval = setInterval(loadDashboardData, 10000); // Refresh every 10 seconds
    return () => clearInterval(interval);
  }, []);
  
  const loadDashboardData = async () => {
    try {
      setIsLoading(true);
      
      // Load rotation statistics
      const statsResponse = await fetch('/api/dashboard/rotation-stats');
      if (statsResponse.ok) {
        const statsData = await statsResponse.json();
        setRotationStats(statsData);
      }
      
      // Load recent rotations
      const rotationsResponse = await fetch('/api/dashboard/recent-rotations');
      if (rotationsResponse.ok) {
        const rotationsData = await rotationsResponse.json();
        setRecentRotations(rotationsData);
      }
      
      // Load active passwords
      const passwordsResponse = await fetch('/api/dashboard/active-passwords');
      if (passwordsResponse.ok) {
        const passwordsData = await passwordsResponse.json();
        setActivePasswords(passwordsData);
      }
      
    } catch (error) {
      console.error('Failed to load dashboard data:', error);
    } finally {
      setIsLoading(false);
    }
  };
  
  const forceRotatePassword = async (passwordId: string) => {
    try {
      const response = await fetch('/api/passwords/force-rotate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passwordId })
      });
      
      if (response.ok) {
        loadDashboardData(); // Refresh data
      }
    } catch (error) {
      console.error('Failed to force rotate password:', error);
    }
  };
  
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
        >
          <RefreshCw className="h-8 w-8 text-blue-500" />
        </motion.div>
      </div>
    );
  }
  
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 dark:from-slate-900 dark:to-blue-900">
      {/* Revolutionary Header */}
      <div className="bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm border-b border-slate-200 dark:border-slate-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2">
                <Crown className="h-8 w-8 text-yellow-500" />
                <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
                  PoofPass Revolutionary Dashboard
                </h1>
              </div>
              <Badge variant="default" className="bg-gradient-to-r from-purple-500 to-pink-500">
                <Zap className="h-3 w-3 mr-1" />
                UNHACKABLE
              </Badge>
            </div>
            
            <div className="flex items-center space-x-4">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowSensitiveData(!showSensitiveData)}
              >
                {showSensitiveData ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                {showSensitiveData ? "Hide" : "Show"} Sensitive
              </Button>
              
              <Button variant="outline" size="sm" onClick={loadDashboardData}>
                <RefreshCw className="h-4 w-4" />
                Refresh
              </Button>
            </div>
          </div>
        </div>
      </div>
      
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Revolutionary Concept Banner */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8"
        >
          <Card className="bg-gradient-to-r from-purple-500 to-pink-500 text-white border-0">
            <CardContent className="p-6">
              <div className="flex items-center space-x-4">
                <Shield className="h-12 w-12 text-white" />
                <div>
                  <h2 className="text-2xl font-bold">THE REVOLUTIONARY CONCEPT</h2>
                  <p className="text-lg opacity-90">
                    Passwords automatically rotate after each login attempt, making them truly unhackable by design.
                    No more credential reuse attacks. No more stolen passwords. Just pure security.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>
        
        {/* Rotation Statistics */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
          >
            <Card className="bg-white/50 dark:bg-slate-800/50 backdrop-blur-sm border-slate-200 dark:border-slate-700">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-slate-600 dark:text-slate-400">
                      Total Rotations
                    </p>
                    <p className="text-3xl font-bold text-slate-900 dark:text-white">
                      {rotationStats.totalRotations}
                    </p>
                  </div>
                  <RotateCcw className="h-8 w-8 text-blue-500" />
                </div>
                <div className="mt-4 flex items-center text-sm text-green-600">
                  <CheckCircle className="h-4 w-4 mr-1" />
                  {rotationStats.successfulRotations} successful
                </div>
              </CardContent>
            </Card>
          </motion.div>
          
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
          >
            <Card className="bg-white/50 dark:bg-slate-800/50 backdrop-blur-sm border-slate-200 dark:border-slate-700">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-slate-600 dark:text-slate-400">
                      Active Passwords
                    </p>
                    <p className="text-3xl font-bold text-slate-900 dark:text-white">
                      {activePasswords.length}
                    </p>
                  </div>
                  <Key className="h-8 w-8 text-green-500" />
                </div>
                <div className="mt-4 flex items-center text-sm text-blue-600">
                  <Lock className="h-4 w-4 mr-1" />
                  All unhackable
                </div>
              </CardContent>
            </Card>
          </motion.div>
          
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
          >
            <Card className="bg-white/50 dark:bg-slate-800/50 backdrop-blur-sm border-slate-200 dark:border-slate-700">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-slate-600 dark:text-slate-400">
                      Rotations/Day
                    </p>
                    <p className="text-3xl font-bold text-slate-900 dark:text-white">
                      {rotationStats.averageRotationsPerDay}
                    </p>
                  </div>
                  <TrendingUp className="h-8 w-8 text-purple-500" />
                </div>
                <div className="mt-4 flex items-center text-sm text-purple-600">
                  <Activity className="h-4 w-4 mr-1" />
                  Auto-rotating
                </div>
              </CardContent>
            </Card>
          </motion.div>
          
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
          >
            <Card className="bg-white/50 dark:bg-slate-800/50 backdrop-blur-sm border-slate-200 dark:border-slate-700">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-slate-600 dark:text-slate-400">
                      Top Service
                    </p>
                    <p className="text-3xl font-bold text-slate-900 dark:text-white">
                      {rotationStats.mostRotatedService}
                    </p>
                  </div>
                  <Target className="h-8 w-8 text-orange-500" />
                </div>
                <div className="mt-4 flex items-center text-sm text-orange-600">
                  <Globe className="h-4 w-4 mr-1" />
                  Most active
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </div>
        
        {/* Main Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Recent Rotations */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.5 }}
          >
            <Card className="bg-white/50 dark:bg-slate-800/50 backdrop-blur-sm border-slate-200 dark:border-slate-700">
              <CardHeader>
                <CardTitle className="flex items-center">
                  <RotateCcw className="h-5 w-5 mr-2" />
                  Recent Auto-Rotations
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <AnimatePresence>
                    {recentRotations.map((rotation) => (
                      <motion.div
                        key={rotation.id}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        className="flex items-start space-x-3 p-3 rounded-lg bg-slate-50 dark:bg-slate-700"
                      >
                        {rotation.success ? (
                          <CheckCircle className="h-5 w-5 text-green-500 mt-0.5" />
                        ) : (
                          <AlertTriangle className="h-5 w-5 text-yellow-500 mt-0.5" />
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-900 dark:text-white">
                            {rotation.service}
                          </p>
                          <p className="text-sm text-slate-600 dark:text-slate-400">
                            {rotation.reason}
                          </p>
                          <p className="text-xs text-slate-500 dark:text-slate-500 mt-1">
                            {rotation.timestamp.toLocaleTimeString()}
                          </p>
                        </div>
                        <Badge variant={rotation.success ? "default" : "secondary"}>
                          {rotation.success ? "Success" : "Failed"}
                        </Badge>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                  
                  {recentRotations.length === 0 && (
                    <div className="text-center py-8 text-slate-500 dark:text-slate-400">
                      <RotateCcw className="h-12 w-12 mx-auto mb-4 text-slate-400" />
                      <p>No rotations yet</p>
                      <p className="text-sm">Rotations will appear here after login attempts</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </motion.div>
          
          {/* Active Passwords */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.6 }}
          >
            <Card className="bg-white/50 dark:bg-slate-800/50 backdrop-blur-sm border-slate-200 dark:border-slate-700">
              <CardHeader>
                <CardTitle className="flex items-center">
                  <Key className="h-5 w-5 mr-2" />
                  Active Unhackable Passwords
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <AnimatePresence>
                    {activePasswords.map((password) => (
                      <motion.div
                        key={password.id}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        className="flex items-center justify-between p-3 rounded-lg bg-slate-50 dark:bg-slate-700"
                      >
                        <div className="flex items-center space-x-3">
                          <div className="flex-shrink-0">
                            {password.status === 'active' ? (
                              <Lock className="h-5 w-5 text-green-500" />
                            ) : (
                              <Unlock className="h-5 w-5 text-gray-500" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-slate-900 dark:text-white">
                              {password.label}
                            </p>
                            {password.service && (
                              <p className="text-sm text-slate-600 dark:text-slate-400">
                                {password.service}
                              </p>
                            )}
                            <p className="text-xs text-slate-500 dark:text-slate-500">
                              Rotated {password.rotationCount} times
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center space-x-2">
                          <Badge variant="default" className="bg-green-500">
                            Unhackable
                          </Badge>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => forceRotatePassword(password.id)}
                          >
                            <RotateCcw className="h-3 w-3" />
                          </Button>
                        </div>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                  
                  {activePasswords.length === 0 && (
                    <div className="text-center py-8 text-slate-500 dark:text-slate-400">
                      <Key className="h-12 w-12 mx-auto mb-4 text-slate-400" />
                      <p>No active passwords</p>
                      <p className="text-sm">Create your first unhackable password</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </div>
        
        {/* Revolutionary Features */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.7 }}
          className="mt-8"
        >
          <Card className="bg-white/50 dark:bg-slate-800/50 backdrop-blur-sm border-slate-200 dark:border-slate-700">
            <CardHeader>
              <CardTitle className="flex items-center">
                <Crown className="h-5 w-5 mr-2 text-yellow-500" />
                Revolutionary Features
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="text-center p-4">
                  <RotateCcw className="h-12 w-12 mx-auto mb-4 text-blue-500" />
                  <h3 className="text-lg font-semibold mb-2">Auto-Rotation</h3>
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    Passwords automatically rotate after each login attempt, making them single-use tokens.
                  </p>
                </div>
                
                <div className="text-center p-4">
                  <Shield className="h-12 w-12 mx-auto mb-4 text-green-500" />
                  <h3 className="text-lg font-semibold mb-2">Unhackable by Design</h3>
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    Even if a password is stolen, it becomes useless after the next login attempt.
                  </p>
                </div>
                
                <div className="text-center p-4">
                  <Zap className="h-12 w-12 mx-auto mb-4 text-purple-500" />
                  <h3 className="text-lg font-semibold mb-2">Zero Credential Reuse</h3>
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    Eliminates credential reuse attacks by design. Each login gets a fresh password.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </div>
  );
}
