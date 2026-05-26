import type React from 'react';

// ==========================================
// 1. TYPES & INTERFACES
// ==========================================

export type ViewState =
  | 'home'
  | 'wizard'
  | 'topup'
  | 'wait_payment'
  | 'success_payment'
  | 'devices'
  | 'extend_subscription'
  | 'buy_device'
  | 'instruction_view'
  | 'history'
  | 'referral'
  | 'referral_detail'
  | 'promo';

export type PlatformId = 'android' | 'ios' | 'windows' | 'macos' | 'linux' | 'androidtv';

export interface Plan {
  id: string;
  duration: string;
  price: number;
  highlight: boolean;
  days: number;
  isTrial?: boolean;
}

export interface PaymentMethodVariant {
  id: string;
  name: string;
  feePercent: number;
}

export interface PaymentMethod {
  id: string;
  name: string;
  icon: string | React.ReactNode;
  feePercent: number;
  variants?: PaymentMethodVariant[];
}

export interface Device {
  id: number;
  name: string;
  type: PlatformId | string;
  added: string;
  key_uuid?: string;
  short_uuid?: string;
  key_status?: string;
  days_left?: number;
  hours_left?: number;
  is_expired?: boolean;
  expiry_date?: string;
  devices_limit?: number;
  is_trial?: boolean;
}

export interface HistoryItem {
  id: number;
  type: string;
  title: string;
  amount: number;
  date: string;
}

export interface ReferralTransaction {
  date: string;
  title: string;
  type: string;
  amount: number;
  income: number;
}

export interface ReferralUser {
  id: number;
  name: string;
  date: string;
  spent: number;
  myProfit: number;
  lineLabel?: string;
  ratePercent?: number;
  invitedCount?: number;
  history: ReferralTransaction[];
}

export interface InstructionStep {
  title: string;
  desc: string;
  actions?: {
    label: string;
    type?: 'copy_key' | 'trigger_add' | 'nav_android' | 'nav_ios' | 'copy_plain_sub';
    url?: string;
    primary?: boolean;
  }[];
}

export interface PlatformData {
  id: PlatformId;
  title: string;
  icon: React.ReactNode;
  steps: InstructionStep[];
}

// ==========================================
// Panel types
// ==========================================

export type ToastType = 'success' | 'error' | 'info';
export type TransactionType = 'income' | 'expense';
export type UserStatus = 'Active' | 'Trial' | 'Banned' | 'Expired';
export type KeyStatus = 'Active' | 'Expired' | 'Banned';

export interface Toast {
  id: number;
  title: string;
  message?: string;
  type: ToastType;
}

export interface Transaction {
  id: number;
  user: string;
  amount: number;
  type: TransactionType;
  status: string;
  method: string;
  date: string;
  hash: string;
}

export interface AutoPayDetails {
  sbp: boolean;
  card: boolean;
  crypto: boolean;
}

export interface User {
  id: number;
  telegramId: number;
  username: string;
  name: string;
  balance: number;
  status: UserStatus;
  traffic: number;
  maxTraffic: number;
  devices: number;
  maxDevices: number;
  regDate: string;
  paidUntil: string;
  autoPayDetails: AutoPayDetails;
  refLink: string;
  refCode: string;
  squads: string[];
  firstDeposit: boolean;
  wasPaid: boolean;
  isPartner: boolean;
  partnerBalance: number;
  partnerRate: number;
  secondLevelRate: number;
  thirdLevelRate: number;
  referrals: number;
  totalEarned: number;
  inBlacklist: boolean;
}

export interface KeyItem {
  id: number;
  key: string;
  user: string;
  status: KeyStatus;
  expiry: number;
  trafficUsed: number;
  trafficLimit: number;
  devicesUsed: number;
  devicesLimit: number;
  server: string;
}

export interface Promo {
  id: number;
  code: string;
  type: 'balance' | 'discount' | 'ref_boost' | 'subscription';
  value: string;
  uses: number;
  limit: number;
  expires: string;
}
