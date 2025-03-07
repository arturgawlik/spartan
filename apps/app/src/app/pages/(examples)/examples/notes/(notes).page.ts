import { Component, computed, inject, signal } from '@angular/core';
import { AsyncPipe, DatePipe, JsonPipe, NgFor, NgIf } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouteMeta } from '@analogjs/router';
import { HlmButtonDirective } from '@spartan-ng/ui-button-helm';
import { HlmInputDirective } from '@spartan-ng/ui-input-helm';
import { RouterLink } from '@angular/router';
import { HlmLabelDirective } from '@spartan-ng/ui-label-helm';
import { HlmSpinnerComponent } from '@spartan-ng/ui-spinner-helm';
import { SignalFormBuilder, SignalInputDirective, V, withErrorComponent } from 'ng-signal-forms';
import { waitFor } from '@analogjs/trpc';
import { catchError, Observable, of, Subject, switchMap, take, tap } from 'rxjs';
import { injectTRPCClient } from '~/trpc-client';
import { Note } from '~/db';
import { SpartanInputErrorDirective } from '~/app/shared/input-error/input-error.directive';
import { InputErrorComponent } from '~/app/shared/input-error/input-error.component';
import { metaWith } from '~/app/shared/meta/meta.util';
import { NoteComponent } from './components/note.component';
import { NoteSkeletonComponent } from './components/note-skeleton.component';
import { NotesEmptyComponent } from './components/notes-empty.component';

export const routeMeta: RouteMeta = {
  meta: metaWith('spartan/examples - Notes', 'A notes example displaying the SPARTAN stack and new UI primitives'),
  title: 'spartan/examples - Notes',
};

@Component({
  selector: 'spartan-notes-example',
  standalone: true,
  imports: [
    AsyncPipe,
    FormsModule,
    NgFor,
    DatePipe,
    NgIf,
    JsonPipe,

    RouterLink,
    SignalInputDirective,
    SpartanInputErrorDirective,

    HlmButtonDirective,
    HlmLabelDirective,
    HlmInputDirective,

    NoteComponent,
    NoteSkeletonComponent,
    NotesEmptyComponent,
    HlmSpinnerComponent,
  ],
  providers: [withErrorComponent(InputErrorComponent)],
  host: {
    class: 'block p-2 sm:p-4 pb-16',
  },
  template: `
    <form class="py-2 flex flex-col items-end">
      <label hlmLabel class="w-full">
        Title
        <input
          class="mt-1.5 w-full"
          placeholder="Buy groceries"
          hlmInput
          autocomplete="off"
          name="newTitle"
          ngModel
          [formField]="form.controls.title"
        />
      </label>

      <label hlmLabel class="w-full">
        Content
        <textarea
          class="mt-1.5 w-full h-fit"
          placeholder="2x eggs, 1x milk,..."
          hlmInput
          autocomplete="off"
          name="newContent"
          ngModel
          rows="4"
          [formField]="form.controls.content"
        ></textarea>
      </label>

      <button hlmBtn [disabled]="createLoad()" variant="secondary" (click)="createNote()">
        <span>{{ createLoad() ? 'Creating' : 'Create' }} Note</span>
        <hlm-spinner *ngIf="createLoad()" class="ml-2" size="sm" />
      </button>
    </form>
    <div class="flex flex-col space-y-4 pt-4 pb-12">
      <ng-container *ngIf="showNotesArray()">
        <analog-trpc-note
          *ngFor="let note of state().notes ?? []; trackBy: noteTrackBy"
          [note]="note"
          [deletionInProgress]="deleteIdInProgress() === note.id"
          (deleteClicked)="deleteNote(note.id)"
        />
        <analog-trpc-notes-empty class="border-transparent shadow-none" *ngIf="noNotes()"></analog-trpc-notes-empty>
      </ng-container>

      <analog-trpc-note-skeleton *ngIf="initialLoad() || createLoad()" />
    </div>
  `,
})
export default class NotesExamplePageComponent {
  private _trpc = injectTRPCClient();
  private _sfb = inject(SignalFormBuilder);
  private _refreshNotes$ = new Subject<void>();
  private _notes$ = this._refreshNotes$.pipe(
    switchMap(() => this._trpc.note.list.query()),
    tap((result) =>
      this.state.mutate((state) => {
        state.status = 'success';
        state.notes = result;
        state.error = null;
      })
    ),
    catchError((err) => {
      this.state.mutate((state) => {
        state.notes = [];
        state.status = 'error';
        state.error = err;
      });
      return of([]);
    })
  );

  public state = signal<{
    status: 'idle' | 'loading' | 'success' | 'error';
    notes: Note[];
    error: any | null;
    updatedFrom: 'initial' | 'create' | 'delete';
    idBeingDeleted?: number;
  }>({
    status: 'idle',
    notes: [],
    error: null,
    updatedFrom: 'initial',
  });
  public initialLoad = computed(() => this.state().status === 'loading' && this.state().updatedFrom === 'initial');
  public createLoad = computed(() => this.state().status === 'loading' && this.state().updatedFrom === 'create');
  public deleteIdInProgress = computed(() =>
    this.state().status === 'loading' && this.state().updatedFrom === 'delete' ? this.state().idBeingDeleted : undefined
  );
  public noNotes = computed(() => this.state().notes.length === 0);
  public showNotesArray = computed(
    () => this.state().updatedFrom === 'delete' || this.state().notes.length > 0 || this.state().status === 'success'
  );

  public form = this._sfb.createFormGroup(() => ({
    title: this._sfb.createFormField<string>('', {
      validators: [
        {
          validator: V.required(),
          message: () => 'Make sure to give your note a title',
        },
      ],
    }),
    content: this._sfb.createFormField('', {
      validators: [
        {
          validator: V.required(),
          message: () => 'Add some content to your note',
        },
      ],
    }),
  }));

  constructor() {
    this._notes$.subscribe();
    void waitFor(this._notes$);
    this.updateNotes('initial');
  }

  public noteTrackBy = (index: number, note: Note) => {
    return note.id;
  };

  public createNote() {
    if (this.form.state() !== 'VALID') {
      this.form.markAllAsTouched();
      return;
    }
    const { title, content } = this.form.value();
    this.updateNotes('create', this._trpc.note.create.mutate({ title, content }));
    this.form.reset();
  }

  public deleteNote(id: number) {
    this.updateNotes('delete', this._trpc.note.remove.mutate({ id }), id);
  }

  private updateNotes(
    updatedFrom: 'initial' | 'create' | 'delete',
    operation?: Observable<Note | Note[]>,
    idBeingDeleted?: number
  ) {
    this.state.update((state) => ({
      status: 'loading',
      notes: state.notes,
      error: null,
      updatedFrom,
      idBeingDeleted,
    }));
    if (!operation) {
      this._refreshNotes$.next();
      return;
    }
    operation.pipe(take(1)).subscribe(() => this._refreshNotes$.next());
  }
}
