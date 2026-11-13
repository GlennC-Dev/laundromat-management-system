import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useForm } from "react-hook-form";
import { useOutletContext } from "react-router";
import { toast } from "sonner";
import { z } from "zod";

import { SelectField, SwitchField, TextField } from "@/components/form-fields";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Form } from "@/components/ui/form";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { adminUsers } from "@/lib/admin-users";
import type { Tables } from "@/lib/database.types";
import type { Profile } from "@/lib/profile";
import { supabase } from "@/lib/supabase";

type Row = Tables<"profiles">;
const ROLE_OPTIONS = [
  { value: "staff", label: "Staff (attendant)" },
  { value: "admin", label: "Admin" },
];
const password = z.string().min(8, "At least 8 characters");

const createSchema = z.object({
  display_name: z.string().trim().min(1, "Enter a name"),
  email: z.string().trim().min(1, "Enter a login email").email("Enter a valid email"),
  password,
  role: z.enum(["staff", "admin"]),
});
type CreateValues = z.infer<typeof createSchema>;

function CreateDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const form = useForm<CreateValues>({
    resolver: zodResolver(createSchema),
    defaultValues: { display_name: "", email: "", password: "", role: "staff" },
  });
  const create = useMutation({
    mutationFn: (v: CreateValues) => adminUsers<{ id: string }>({ action: "create", ...v }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["profiles"] });
      await qc.invalidateQueries({ queryKey: ["user_emails"] });
      toast.success("User created");
      form.reset();
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Add user</DialogTitle>
          <DialogDescription>They sign in with this email and password.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((v) => create.mutate(v))}
            className="space-y-4"
            noValidate
          >
            <TextField control={form.control} name="display_name" label="Name" />
            <TextField
              control={form.control}
              name="email"
              label="Login email"
              type="email"
              autoComplete="off"
            />
            <TextField
              control={form.control}
              name="password"
              label="Password"
              type="password"
              autoComplete="new-password"
            />
            <SelectField control={form.control} name="role" label="Role" options={ROLE_OPTIONS} />
            <Button type="submit" className="h-11 w-full" disabled={create.isPending}>
              {create.isPending ? "Creating…" : "Create user"}
            </Button>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

const editSchema = z.object({
  display_name: z.string().trim().min(1, "Enter a name"),
  role: z.enum(["staff", "admin"]),
  active: z.boolean(),
});
type EditValues = z.infer<typeof editSchema>;
const passwordSchema = z.object({ password });
type PasswordValues = z.infer<typeof passwordSchema>;

function EditDialog({ user, onClose }: { user: Row | null; onClose: () => void }) {
  const qc = useQueryClient();
  const form = useForm<EditValues>({
    resolver: zodResolver(editSchema),
    values: {
      display_name: user?.display_name ?? "",
      role: user?.role ?? "staff",
      active: user?.active ?? true,
    },
  });
  const pw = useForm<PasswordValues>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { password: "" },
  });

  const save = useMutation({
    mutationFn: async (v: EditValues) => {
      const { error } = await supabase.from("profiles").update(v).eq("id", user!.id);
      if (error) throw error;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["profiles"] });
      toast.success("User updated");
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const setPassword = useMutation({
    mutationFn: (v: PasswordValues) =>
      adminUsers({ action: "set_password", id: user!.id, password: v.password }),
    onSuccess: () => {
      toast.success("Password changed");
      pw.reset();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={user !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Edit {user?.display_name}</DialogTitle>
          <DialogDescription>
            Deactivating blocks sign-in access without deleting history.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((v) => save.mutate(v))}
            className="space-y-4"
            noValidate
          >
            <TextField control={form.control} name="display_name" label="Name" />
            <SelectField control={form.control} name="role" label="Role" options={ROLE_OPTIONS} />
            <SwitchField control={form.control} name="active" label="Active" />
            <Button type="submit" className="h-11 w-full" disabled={save.isPending}>
              {save.isPending ? "Saving…" : "Save"}
            </Button>
          </form>
        </Form>
        <Form {...pw}>
          <form
            onSubmit={pw.handleSubmit((v) => setPassword.mutate(v))}
            className="space-y-3 border-t pt-4"
            noValidate
          >
            <TextField
              control={pw.control}
              name="password"
              label="New password"
              type="password"
              autoComplete="new-password"
            />
            <Button
              type="submit"
              variant="outline"
              className="h-11 w-full"
              disabled={setPassword.isPending}
            >
              {setPassword.isPending ? "Changing…" : "Change password"}
            </Button>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

export function UsersPage() {
  const me = useOutletContext<Profile>();
  const [editing, setEditing] = useState<Row | null>(null);
  const [creating, setCreating] = useState(false);

  const users = useQuery({
    queryKey: ["profiles"],
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("*").order("display_name");
      if (error) throw error;
      return data;
    },
  });
  // Emails live in auth, so they come from the admin function; the page works without them.
  const emails = useQuery({
    queryKey: ["user_emails"],
    queryFn: async () => {
      const { users } = await adminUsers<{ users: { id: string; email: string | null }[] }>({
        action: "list",
      });
      return new Map(users.map((u) => [u.id, u.email]));
    },
    retry: false,
  });

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
          <p className="text-sm text-muted-foreground">Admins and attendants who can sign in.</p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <Plus aria-hidden /> Add user
        </Button>
      </div>
      <div className="overflow-x-auto rounded-xl border bg-background">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Login</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.isLoading && (
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            )}
            {users.isError && (
              <TableRow>
                <TableCell colSpan={5} className="text-destructive">
                  Could not load users.
                </TableCell>
              </TableRow>
            )}
            {users.data?.map((u) => (
              <TableRow key={u.id} className={u.active ? "" : "opacity-60"}>
                <TableCell className="font-medium">
                  {u.display_name}
                  {u.id === me.id && (
                    <span className="ml-2 text-xs text-muted-foreground">(you)</span>
                  )}
                </TableCell>
                <TableCell>{emails.data?.get(u.id) ?? "–"}</TableCell>
                <TableCell>
                  <Badge variant={u.role === "admin" ? "default" : "secondary"}>{u.role}</Badge>
                </TableCell>
                <TableCell>
                  {u.active ? "Active" : <Badge variant="outline">Deactivated</Badge>}
                </TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="sm" onClick={() => setEditing(u)}>
                    Edit
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <CreateDialog open={creating} onOpenChange={setCreating} />
      <EditDialog user={editing} onClose={() => setEditing(null)} />
    </div>
  );
}
