export type ManagementEvent =
  | { kind: 'portfolio-updated' | 'portfolio-deleted' | 'account-updated' | 'account-deleted'; id: string; message: string }
  | { kind: 'accounts-moved'; ids: string[]; message: string }
