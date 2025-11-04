import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, isToday, addMonths, subMonths } from "date-fns";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Calendar as CalendarIcon, List, ChevronLeft, ChevronRight, Phone, Mail, Users2, CheckSquare, FileText } from "lucide-react";
import { Link } from "wouter";
import type { Activity } from "@shared/schema";

const ACTIVITY_ICONS = {
  call: Phone,
  email: Mail,
  meeting: Users2,
  task: CheckSquare,
  note: FileText,
};

const ACTIVITY_COLORS = {
  call: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  email: "bg-purple-500/10 text-purple-700 dark:text-purple-400",
  meeting: "bg-green-500/10 text-green-700 dark:text-green-400",
  task: "bg-orange-500/10 text-orange-700 dark:text-orange-400",
  note: "bg-gray-500/10 text-gray-700 dark:text-gray-400",
};

export function UpcomingActivitiesCard() {
  const [view, setView] = useState<"list" | "calendar">(() => {
    const saved = localStorage.getItem("activities-view");
    return (saved === "list" || saved === "calendar") ? saved : "list";
  });
  
  const [currentMonth, setCurrentMonth] = useState(new Date());

  const { data: activities = [], isLoading } = useQuery<Activity[]>({
    queryKey: ["/api/activities/upcoming"],
  });

  const handleViewChange = (newView: "list" | "calendar") => {
    setView(newView);
    localStorage.setItem("activities-view", newView);
  };

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const daysInMonth = eachDayOfInterval({ start: monthStart, end: monthEnd });
  
  const startDayOfWeek = monthStart.getDay();
  const emptyDays = Array(startDayOfWeek).fill(null);

  const getActivitiesForDay = (day: Date) => {
    return activities.filter(activity => 
      activity.dueAt && isSameDay(new Date(activity.dueAt), day)
    );
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-4">
        <div>
          <CardTitle>Upcoming Activities</CardTitle>
          <CardDescription>Your scheduled tasks and meetings</CardDescription>
        </div>
        <div className="flex gap-1">
          <Button
            variant={view === "list" ? "default" : "ghost"}
            size="sm"
            onClick={() => handleViewChange("list")}
            data-testid="button-list-view"
          >
            <List className="h-4 w-4" />
          </Button>
          <Button
            variant={view === "calendar" ? "default" : "ghost"}
            size="sm"
            onClick={() => handleViewChange("calendar")}
            data-testid="button-calendar-view"
          >
            <CalendarIcon className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-sm text-muted-foreground">Loading activities...</div>
        ) : view === "list" ? (
          <div className="space-y-3" data-testid="list-view">
            {activities.length === 0 ? (
              <p className="text-sm text-muted-foreground">No upcoming activities</p>
            ) : (
              activities.slice(0, 10).map((activity) => {
                const Icon = ACTIVITY_ICONS[activity.type as keyof typeof ACTIVITY_ICONS];
                return (
                  <Link key={activity.id} href={`/activities/${activity.id}`}>
                    <div className="flex items-start gap-3 p-3 rounded-md hover-elevate active-elevate-2 cursor-pointer" data-testid={`activity-item-${activity.id}`}>
                      <div className={`p-2 rounded-md ${ACTIVITY_COLORS[activity.type as keyof typeof ACTIVITY_COLORS]}`}>
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-medium text-sm truncate">{activity.subject}</p>
                          <Badge variant="outline" className="text-xs">
                            {activity.type}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
                          {activity.dueAt && (
                            <span>{format(new Date(activity.dueAt), "MMM d, h:mm a")}</span>
                          )}
                          {activity.relatedType && activity.relatedId && (
                            <span className="truncate">
                              {activity.relatedType}: {activity.relatedId}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </Link>
                );
              })
            )}
          </div>
        ) : (
          <div className="space-y-4" data-testid="calendar-view">
            <div className="flex items-center justify-between">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
                data-testid="button-prev-month"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <h3 className="font-semibold">{format(currentMonth, "MMMM yyyy")}</h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
                data-testid="button-next-month"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
            
            <div className="grid grid-cols-7 gap-1">
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(day => (
                <div key={day} className="text-center text-xs font-medium text-muted-foreground p-2">
                  {day}
                </div>
              ))}
              
              {emptyDays.map((_, index) => (
                <div key={`empty-${index}`} className="p-2 min-h-[60px]" />
              ))}
              
              {daysInMonth.map(day => {
                const dayActivities = getActivitiesForDay(day);
                const isCurrentDay = isToday(day);
                
                return (
                  <div
                    key={day.toISOString()}
                    className={`p-2 min-h-[60px] rounded-md border ${
                      isCurrentDay ? "border-primary bg-accent" : "border-border"
                    }`}
                    data-testid={`calendar-day-${format(day, "yyyy-MM-dd")}`}
                  >
                    <div className={`text-xs font-medium mb-1 ${
                      isCurrentDay ? "text-primary" : "text-foreground"
                    }`}>
                      {format(day, "d")}
                    </div>
                    <div className="space-y-1">
                      {dayActivities.slice(0, 2).map(activity => {
                        const Icon = ACTIVITY_ICONS[activity.type as keyof typeof ACTIVITY_ICONS];
                        return (
                          <Link key={activity.id} href={`/activities/${activity.id}`}>
                            <div
                              className={`flex items-center gap-1 p-1 rounded text-xs cursor-pointer hover-elevate ${
                                ACTIVITY_COLORS[activity.type as keyof typeof ACTIVITY_COLORS]
                              }`}
                              title={activity.subject}
                              data-testid={`calendar-activity-${activity.id}`}
                            >
                              <Icon className="h-3 w-3 flex-shrink-0" />
                              <span className="truncate text-xs">{activity.subject}</span>
                            </div>
                          </Link>
                        );
                      })}
                      {dayActivities.length > 2 && (
                        <div className="text-xs text-muted-foreground">
                          +{dayActivities.length - 2} more
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
