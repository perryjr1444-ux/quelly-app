export type PasswordStatus = 'active' | 'used';

export interface DisposablePassword {
  id: string;
  user_id: string;
  password: string;
  status: PasswordStatus;
  created_at: string;
}
