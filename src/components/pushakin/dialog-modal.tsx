'use client'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useAppStore } from '@/lib/store'
import { AlertCircle } from 'lucide-react'

export function DialogModal() {
  const { dialog, closeDialog } = useAppStore()

  return (
    <AlertDialog open={dialog.isOpen} onOpenChange={(open) => !open && closeDialog()}>
      <AlertDialogContent className="max-w-sm mx-4 sm:mx-0">
        <AlertDialogHeader className="items-center text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-indigo-100">
            <AlertCircle className="h-6 w-6 text-indigo-600" />
          </div>
          <AlertDialogTitle className="text-center">
            {dialog.type === 'confirm' ? 'Konfirmasi' : 'Informasi'}
          </AlertDialogTitle>
          <AlertDialogDescription className="text-center">
            {dialog.message}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-col gap-2 sm:flex-row sm:justify-center">
          {dialog.type === 'confirm' && (
            <AlertDialogCancel onClick={closeDialog}>
              Batal
            </AlertDialogCancel>
          )}
          <AlertDialogAction
            onClick={() => {
              if (dialog.onConfirm) dialog.onConfirm()
              closeDialog()
            }}
            className="bg-indigo-600 hover:bg-indigo-700"
          >
            {dialog.type === 'confirm' ? 'Ya, Lanjutkan' : 'Mengerti'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
