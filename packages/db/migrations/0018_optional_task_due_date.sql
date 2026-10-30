-- A due date is optional for every priority, including High.

alter table tasks drop constraint tasks_high_critical_need_due_date;
