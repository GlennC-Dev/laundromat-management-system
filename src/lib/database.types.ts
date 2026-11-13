// Generated from the Supabase project schema (regenerate after every migration).
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

type E = Database["public"]["Enums"];

export type Database = {
  __InternalSupabase: { PostgrestVersion: "14.18" };
  public: {
    Tables: {
      audit_log: {
        Row: {
          action: string;
          actor: string | null;
          after: Json | null;
          at: string;
          before: Json | null;
          id: number;
          row_id: string;
          table_name: string;
        };
        Insert: {
          action: string;
          actor?: string | null;
          after?: Json | null;
          at?: string;
          before?: Json | null;
          id?: never;
          row_id: string;
          table_name: string;
        };
        Update: {
          action?: string;
          actor?: string | null;
          after?: Json | null;
          at?: string;
          before?: Json | null;
          id?: never;
          row_id?: string;
          table_name?: string;
        };
        Relationships: [];
      };
      machines: {
        Row: {
          active: boolean;
          capacity_kg: number;
          created_at: string;
          element_kw: number | null;
          id: string;
          label: string;
          motor_kw: number;
          status: E["machine_status"];
          type: E["machine_type"];
          water_l_per_cycle: number | null;
        };
        Insert: {
          active?: boolean;
          capacity_kg: number;
          created_at?: string;
          element_kw?: number | null;
          id?: string;
          label: string;
          motor_kw: number;
          status?: E["machine_status"];
          type: E["machine_type"];
          water_l_per_cycle?: number | null;
        };
        Update: {
          active?: boolean;
          capacity_kg?: number;
          created_at?: string;
          element_kw?: number | null;
          id?: string;
          label?: string;
          motor_kw?: number;
          status?: E["machine_status"];
          type?: E["machine_type"];
          water_l_per_cycle?: number | null;
        };
        Relationships: [];
      };
      price_list: {
        Row: {
          code: E["price_code"] | null;
          created_at: string;
          default_minutes: number | null;
          effective_from: string;
          id: string;
          kind: E["price_kind"];
          level: E["service_level"] | null;
          machine_type: E["machine_type"] | null;
          price: number;
          size_kg: number | null;
        };
        Insert: {
          code?: E["price_code"] | null;
          created_at?: string;
          default_minutes?: number | null;
          effective_from: string;
          id?: string;
          kind: E["price_kind"];
          level?: E["service_level"] | null;
          machine_type?: E["machine_type"] | null;
          price: number;
          size_kg?: number | null;
        };
        Update: {
          code?: E["price_code"] | null;
          created_at?: string;
          default_minutes?: number | null;
          effective_from?: string;
          id?: string;
          kind?: E["price_kind"];
          level?: E["service_level"] | null;
          machine_type?: E["machine_type"] | null;
          price?: number;
          size_kg?: number | null;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          active: boolean;
          created_at: string;
          display_name: string;
          id: string;
          role: E["user_role"];
        };
        Insert: {
          active?: boolean;
          created_at?: string;
          display_name: string;
          id: string;
          role?: E["user_role"];
        };
        Update: {
          active?: boolean;
          created_at?: string;
          display_name?: string;
          id?: string;
          role?: E["user_role"];
        };
        Relationships: [];
      };
      restocks: {
        Row: {
          created_by: string;
          doses: number;
          id: string;
          item: E["stock_item"];
          restocked_at: string;
          unit_cost: number;
        };
        Insert: {
          created_by: string;
          doses: number;
          id?: string;
          item: E["stock_item"];
          restocked_at?: string;
          unit_cost: number;
        };
        Update: {
          created_by?: string;
          doses?: number;
          id?: string;
          item?: E["stock_item"];
          restocked_at?: string;
          unit_cost?: number;
        };
        Relationships: [];
      };
      settings: {
        Row: {
          closing_time: string;
          currency: string;
          dryer_duty_drier: number;
          dryer_duty_driest: number;
          dryer_duty_dry: number;
          id: boolean;
          opening_time: string;
          timezone: string;
          washer_load_factor: number;
          water_factor_clean: number;
          water_factor_cleaner: number;
          water_factor_cleanest: number;
        };
        Insert: {
          closing_time?: string;
          currency?: string;
          dryer_duty_drier?: number;
          dryer_duty_driest?: number;
          dryer_duty_dry?: number;
          id?: boolean;
          opening_time?: string;
          timezone?: string;
          washer_load_factor?: number;
          water_factor_clean?: number;
          water_factor_cleaner?: number;
          water_factor_cleanest?: number;
        };
        Update: {
          closing_time?: string;
          currency?: string;
          dryer_duty_drier?: number;
          dryer_duty_driest?: number;
          dryer_duty_dry?: number;
          id?: boolean;
          opening_time?: string;
          timezone?: string;
          washer_load_factor?: number;
          water_factor_clean?: number;
          water_factor_cleaner?: number;
          water_factor_cleanest?: number;
        };
        Relationships: [];
      };
      tickets: {
        Row: {
          amount_paid: number | null;
          base_minutes: number | null;
          completed_at: string | null;
          completed_by: string | null;
          created_by: string;
          detergent_qty: number;
          detergent_unit_price: number;
          dry_ext_unit_price: number;
          ends_at: string;
          extra_dry_minutes: number;
          extra_spin_count: number;
          fabcon_qty: number;
          fabcon_unit_price: number;
          id: string;
          kind: E["ticket_kind"];
          level: E["service_level"] | null;
          machine_id: string | null;
          payment_method: E["payment_method"] | null;
          reference_no: string | null;
          service_price: number | null;
          spin_minutes: number;
          spin_unit_price: number;
          started_at: string;
          status: E["ticket_status"];
          total: number | null;
          void_reason: string | null;
          voided_at: string | null;
          voided_by: string | null;
        };
        // Tickets are written only through business functions, never directly.
        Insert: never;
        Update: never;
        Relationships: [];
      };
      utility_rates: {
        Row: {
          effective_from: string;
          id: string;
          kind: E["utility_kind"];
          rate: number;
        };
        Insert: {
          effective_from: string;
          id?: string;
          kind: E["utility_kind"];
          rate: number;
        };
        Update: {
          effective_from?: string;
          id?: string;
          kind?: E["utility_kind"];
          rate?: number;
        };
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      app_role: { Args: never; Returns: E["user_role"] };
      restock: {
        Args: { p_doses: number; p_item: E["stock_item"]; p_unit_cost: number };
        Returns: string;
      };
      stock_levels: {
        Args: never;
        Returns: { doses: number; item: E["stock_item"] }[];
      };
    };
    Enums: {
      machine_status: "available" | "out_of_service";
      machine_type: "wash" | "dry";
      payment_method: "cash" | "gcash" | "maya" | "bank_transfer" | "card";
      price_code: "extra_spin" | "dry_extension" | "detergent" | "fabcon";
      price_kind: "service" | "add_on" | "item";
      service_level: "clean" | "cleaner" | "cleanest" | "dry" | "drier" | "driest";
      stock_item: "detergent" | "fabcon";
      ticket_kind: "machine" | "counter";
      ticket_status: "pending" | "completed";
      user_role: "admin" | "staff";
      utility_kind: "electricity" | "water";
    };
    CompositeTypes: { [_ in never]: never };
  };
};

export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];
export type Enums<T extends keyof Database["public"]["Enums"]> = Database["public"]["Enums"][T];
