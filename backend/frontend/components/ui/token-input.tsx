"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input, type InputProps } from "./input";
import { Button } from "./button";
import { cn } from "@/lib/utils";

export function TokenInput({ className, ...props }: InputProps) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input {...props} type={visible ? "text" : "password"} className={cn("pr-10", className)} />
      <Button type="button" variant="ghost" size="icon-sm" className="absolute right-1 top-1" aria-label={visible ? "Hide access token" : "Show access token"} aria-pressed={visible} onClick={() => setVisible((value) => !value)}>
        {visible ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
      </Button>
    </div>
  );
}
