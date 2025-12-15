export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      users: {
        Row: {
          id: string
          email: string
          full_name: string | null
          role: 'admin' | 'designer' | 'employee'
          exclude_from_utilization: boolean
          deleted_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          email: string
          full_name?: string | null
          role?: 'admin' | 'designer' | 'employee'
          exclude_from_utilization?: boolean
          deleted_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          email?: string
          full_name?: string | null
          role?: 'admin' | 'designer' | 'employee'
          exclude_from_utilization?: boolean
          deleted_at?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      monday_projects: {
        Row: {
          id: string
          monday_item_id: string
          monday_board_id: string
          name: string
          client_name: string | null
          completed_date: string | null
          due_date: string | null
          status: 'active' | 'archived' | 'locked'
          quoted_hours: number | null
          quote_value: number | null
          monday_data: Json | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          monday_item_id: string
          monday_board_id: string
          name: string
          client_name?: string | null
          completed_date?: string | null
          due_date?: string | null
          status?: 'active' | 'archived' | 'locked'
          quoted_hours?: number | null
          quote_value?: number | null
          monday_data?: Json | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          monday_item_id?: string
          monday_board_id?: string
          name?: string
          client_name?: string | null
          completed_date?: string | null
          due_date?: string | null
          status?: 'active' | 'archived' | 'locked'
          quoted_hours?: number | null
          quote_value?: number | null
          monday_data?: Json | null
          created_at?: string
          updated_at?: string
        }
      }
      monday_tasks: {
        Row: {
          id: string
          monday_item_id: string
          project_id: string
          name: string
          is_subtask: boolean
          parent_task_id: string | null
          assigned_user_ids: string[] | null
          quoted_hours: number | null
          timeline_start: string | null
          timeline_end: string | null
          monday_data: Json | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          monday_item_id: string
          project_id: string
          name: string
          is_subtask: boolean
          parent_task_id?: string | null
          assigned_user_ids?: string[] | null
          quoted_hours?: number | null
          timeline_start?: string | null
          timeline_end?: string | null
          monday_data?: Json | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          monday_item_id?: string
          project_id?: string
          name?: string
          is_subtask?: boolean
          parent_task_id?: string | null
          assigned_user_ids?: string[] | null
          quoted_hours?: number | null
          timeline_start?: string | null
          timeline_end?: string | null
          monday_data?: Json | null
          created_at?: string
          updated_at?: string
        }
      }
      time_entries: {
        Row: {
          id: string
          user_id: string
          task_id: string
          project_id: string
          date: string
          hours: number
          notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          task_id: string
          project_id: string
          date: string
          hours: number
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          task_id?: string
          project_id?: string
          date?: string
          hours?: number
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      favorite_tasks: {
        Row: {
          id: string
          user_id: string
          task_id: string
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          task_id: string
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          task_id?: string
          created_at?: string
        }
      }
      monday_column_mappings: {
        Row: {
          id: string
          monday_column_id: string
          column_type: 'client' | 'time' | 'quoted_hours' | 'timeline' | 'quote_value' | 'due_date' | 'completed_date' | 'status'
          board_id: string | null
          workspace_id: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          monday_column_id: string
          column_type: 'client' | 'time' | 'quoted_hours' | 'timeline' | 'quote_value' | 'due_date' | 'completed_date' | 'status'
          board_id?: string | null
          workspace_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          monday_column_id?: string
          column_type?: 'client' | 'time' | 'quoted_hours' | 'timeline'
          board_id?: string | null
          workspace_id?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      leads_status_config: {
        Row: {
          id: string
          included_statuses: string[] | null
          excluded_statuses: string[] | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          included_statuses?: string[] | null
          excluded_statuses?: string[] | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          included_statuses?: string[] | null
          excluded_statuses?: string[] | null
          created_at?: string
          updated_at?: string
        }
      }
      monday_completed_boards: {
        Row: {
          id: string
          monday_board_id: string
          board_name: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          monday_board_id: string
          board_name?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          monday_board_id?: string
          board_name?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      monday_sync_settings: {
        Row: {
          id: string
          enabled: boolean
          interval_minutes: number
          last_sync_at: string | null
          next_sync_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          enabled?: boolean
          interval_minutes?: number
          last_sync_at?: string | null
          next_sync_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          enabled?: boolean
          interval_minutes?: number
          last_sync_at?: string | null
          next_sync_at?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      quote_rates: {
        Row: {
          id: string
          customer_type: 'partner' | 'client'
          day_rate_gbp: number
          hours_per_day: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          customer_type: 'partner' | 'client'
          day_rate_gbp: number
          hours_per_day?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          customer_type?: 'partner' | 'client'
          day_rate_gbp?: number
          hours_per_day?: number
          created_at?: string
          updated_at?: string
        }
      }
      documents: {
        Row: {
          id: string
          title: string
          description: string | null
          category: 'hr' | 'sales' | 'operations'
          file_path: string
          file_name: string
          file_size: number | null
          thumbnail_path: string | null
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          title: string
          description?: string | null
          category: 'hr' | 'sales' | 'operations'
          file_path: string
          file_name: string
          file_size?: number | null
          thumbnail_path?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          title?: string
          description?: string | null
          category?: 'hr' | 'sales'
          file_path?: string
          file_name?: string
          file_size?: number | null
          thumbnail_path?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      user_role: 'admin' | 'designer' | 'employee'
      project_status: 'active' | 'archived' | 'locked'
      document_category: 'hr' | 'sales' | 'operations'
    }
  }
}

