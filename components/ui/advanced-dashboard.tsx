'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { 
  Shield, 
  Activity, 
  Users, 
  Key, 
  TrendingUp, 
  AlertTriangle,
  CheckCircle,
  Clock,
  Globe,
  Smartphone,
  Monitor,
  Eye,
  EyeOff,
  RefreshCw,
  Download,
  Upload,
  Settings,
  Bell,
  Search,
  Filter,
  MoreHorizontal
} from 'lucide-react';
import { useWebSocket } from '@/lib/hooks/use-websocket';

interface DashboardMetrics {
  totalPasswords: number;
  activeSessions: number;
  securityScore: number;
  lastBackup: string;
  teamMembers: number;
  sharedPasswords: number;
  failedLogins: number;
  twoFactorEnabled: boolean;
}

interface SecurityAlert {
  id: string;
  type: 'warning' | 'error' | 'info';
  title: string;
  message: string;
  timestamp: Date;
  action?: {
    label: string;
    onClick: () => void;
  };
}

interface RecentActivity {
  id: string;
  type: 'password_created' | 'password_shared' | 'login' | 'backup' | 'team_invite';
  description: string;
  timestamp: Date;
  user?: string;
  icon: React.ReactNode;
}

export default function AdvancedDashboard() {
  const [metrics, setMetrics] = useState<DashboardMetrics>({
    totalPasswords: 0,
    activeSessions: 0,
    securityScore: 0,
    lastBackup: '',
    teamMembers: 0,
    sharedPasswords: 0,
    failedLogins: 0,
    twoFactorEnabled: false,
  });
  
  const [alerts, setAlerts] = useState<SecurityAlert[]>([]);
  const [recentActivity, setRecentActivity] = useState<RecentActivity[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showSensitiveData, setShowSensitiveData] = useState(false);
  
  const { connected: wsConnected } = useWebSocket();
  const onlineUsers: any[] = [];
  
  useEffect(() => {
    loadDashboardData();
    const interval = setInterval(loadDashboardData, 30000); // Refresh every 30 seconds
    return () => clearInterval(interval);
  }, []);
  
  const loadDashboardData = async () => {
    try {
      setIsLoading(true);
      
      // Load metrics
      const metricsResponse = await fetch('/api/dashboard/metrics');
      if (metricsResponse.ok) {
        const metricsData = await metricsResponse.json();
        setMetrics(metricsData);
      }
      
      // Load alerts
      const alertsResponse = await fetch('/api/dashboard/alerts');
      if (alertsResponse.ok) {
        const alertsData = await alertsResponse.json();
        setAlerts(alertsData);
      }
      
      // Load recent activity
      const activityResponse = await fetch('/api/dashboard/activity');
      if (activityResponse.ok) {
        const activityData = await activityResponse.json();
        setRecentActivity(activityData);
      }
      
    } catch (error) {
      console.error('Failed to load dashboard data:', error);
    } finally {
      setIsLoading(false);
    }
  };
  
  const getActivityIcon = (type: string) => {
    switch (type) {
      case 'password_created': return <Key className="h-4 w-4 text-blue-500" />;
      case 'password_shared': return <Users className="h-4 w-4 text-green-500" />;
      case 'login': return <Shield className="h-4 w-4 text-purple-500" />;
      case 'backup': return <Download className="h-4 w-4 text-orange-500" />;
      case 'team_invite': return <Users className="h-4 w-4 text-indigo-500" />;
      default: return <Activity className="h-4 w-4 text-gray-500" />;
    }
  };
  
  const getAlertIcon = (type: string) => {
    switch (type) {
      case 'warning': return <AlertTriangle className="h-5 w-5 text-yellow-500" />;
      case 'error': return <AlertTriangle className="h-5 w-5 text-red-500" />;
      case 'info': return <CheckCircle className="h-5 w-5 text-blue-500" />;
      default: return <AlertTriangle className="h-5 w-5 text-gray-500" />;
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
      {/* Header */}
      <div className="bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm border-b border-slate-200 dark:border-slate-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center space-x-4">
              <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
                PoofPass Dashboard
              </h1>
              <Badge variant={wsConnected ? "default" : "secondary"}>
                {wsConnected ? "Connected" : "Offline"}
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
        {/* Metrics Grid */}
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
                      Total Passwords
                    </p>
                    <p className="text-3xl font-bold text-slate-900 dark:text-white">
                      {showSensitiveData ? metrics.totalPasswords : "***"}
                    </p>
                  </div>
                  <Key className="h-8 w-8 text-blue-500" />
                </div>
                <div className="mt-4 flex items-center text-sm text-green-600">
                  <TrendingUp className="h-4 w-4 mr-1" />
                  +12% from last month
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
                      Security Score
                    </p>
                    <p className="text-3xl font-bold text-slate-900 dark:text-white">
                      {metrics.securityScore}/100
                    </p>
                  </div>
                  <Shield className="h-8 w-8 text-green-500" />
                </div>
                <div className="mt-4 flex items-center text-sm text-green-600">
                  <CheckCircle className="h-4 w-4 mr-1" />
                  Excellent
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
                      Active Sessions
                    </p>
                    <p className="text-3xl font-bold text-slate-900 dark:text-white">
                      {metrics.activeSessions}
                    </p>
                  </div>
                  <Activity className="h-8 w-8 text-purple-500" />
                </div>
                <div className="mt-4 flex items-center text-sm text-slate-600">
                  <Globe className="h-4 w-4 mr-1" />
                  {onlineUsers.length} online
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
                      Team Members
                    </p>
                    <p className="text-3xl font-bold text-slate-900 dark:text-white">
                      {metrics.teamMembers}
                    </p>
                  </div>
                  <Users className="h-8 w-8 text-indigo-500" />
                </div>
                <div className="mt-4 flex items-center text-sm text-blue-600">
                  <Users className="h-4 w-4 mr-1" />
                  {metrics.sharedPasswords} shared
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </div>
        
        {/* Main Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Security Alerts */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.5 }}
            className="lg:col-span-1"
          >
            <Card className="bg-white/50 dark:bg-slate-800/50 backdrop-blur-sm border-slate-200 dark:border-slate-700">
              <CardHeader>
                <CardTitle className="flex items-center">
                  <Bell className="h-5 w-5 mr-2" />
                  Security Alerts
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <AnimatePresence>
                    {alerts.map((alert) => (
                      <motion.div
                        key={alert.id}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        className="flex items-start space-x-3 p-3 rounded-lg bg-slate-50 dark:bg-slate-700"
                      >
                        {getAlertIcon(alert.type)}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-900 dark:text-white">
                            {alert.title}
                          </p>
                          <p className="text-sm text-slate-600 dark:text-slate-400">
                            {alert.message}
                          </p>
                          <p className="text-xs text-slate-500 dark:text-slate-500 mt-1">
                            {alert.timestamp.toLocaleTimeString()}
                          </p>
                        </div>
                        {alert.action && (
                          <Button size="sm" variant="outline" onClick={alert.action.onClick}>
                            {alert.action.label}
                          </Button>
                        )}
                      </motion.div>
                    ))}
                  </AnimatePresence>
                  
                  {alerts.length === 0 && (
                    <div className="text-center py-8 text-slate-500 dark:text-slate-400">
                      <CheckCircle className="h-12 w-12 mx-auto mb-4 text-green-500" />
                      <p>No security alerts</p>
                      <p className="text-sm">Your account is secure</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </motion.div>
          
          {/* Recent Activity */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.6 }}
            className="lg:col-span-2"
          >
            <Card className="bg-white/50 dark:bg-slate-800/50 backdrop-blur-sm border-slate-200 dark:border-slate-700">
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <div className="flex items-center">
                    <Activity className="h-5 w-5 mr-2" />
                    Recent Activity
                  </div>
                  <Button variant="outline" size="sm">
                    <Filter className="h-4 w-4 mr-1" />
                    Filter
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <AnimatePresence>
                    {recentActivity.map((activity) => (
                      <motion.div
                        key={activity.id}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        className="flex items-center space-x-4 p-3 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                      >
                        <div className="flex-shrink-0">
                          {getActivityIcon(activity.type)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-900 dark:text-white">
                            {activity.description}
                          </p>
                          {activity.user && (
                            <p className="text-sm text-slate-600 dark:text-slate-400">
                              by {activity.user}
                            </p>
                          )}
                        </div>
                        <div className="flex-shrink-0 text-xs text-slate-500 dark:text-slate-500">
                          <Clock className="h-3 w-3 inline mr-1" />
                          {activity.timestamp.toLocaleTimeString()}
                        </div>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                  
                  {recentActivity.length === 0 && (
                    <div className="text-center py-8 text-slate-500 dark:text-slate-400">
                      <Activity className="h-12 w-12 mx-auto mb-4 text-slate-400" />
                      <p>No recent activity</p>
                      <p className="text-sm">Activity will appear here</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </div>
        
        {/* Device Presence */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.7 }}
          className="mt-8"
        >
          <Card className="bg-white/50 dark:bg-slate-800/50 backdrop-blur-sm border-slate-200 dark:border-slate-700">
            <CardHeader>
              <CardTitle className="flex items-center">
                <Globe className="h-5 w-5 mr-2" />
                Active Devices
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="flex items-center space-x-3 p-3 rounded-lg bg-slate-50 dark:bg-slate-700">
                  <Monitor className="h-6 w-6 text-blue-500" />
                  <div>
                    <p className="text-sm font-medium">Desktop</p>
                    <p className="text-xs text-slate-600 dark:text-slate-400">2 active sessions</p>
                  </div>
                </div>
                
                <div className="flex items-center space-x-3 p-3 rounded-lg bg-slate-50 dark:bg-slate-700">
                  <Smartphone className="h-6 w-6 text-green-500" />
                  <div>
                    <p className="text-sm font-medium">Mobile</p>
                    <p className="text-xs text-slate-600 dark:text-slate-400">1 active session</p>
                  </div>
                </div>
                
                <div className="flex items-center space-x-3 p-3 rounded-lg bg-slate-50 dark:bg-slate-700">
                  <Globe className="h-6 w-6 text-purple-500" />
                  <div>
                    <p className="text-sm font-medium">Web</p>
                    <p className="text-xs text-slate-600 dark:text-slate-400">Current session</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </div>
  );
}
